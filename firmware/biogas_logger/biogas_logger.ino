/* ============================================================
   BIOGAS ANALYZER  -  PHASE 1 DATA LOGGER  (ESP32, 38-pin)
   ------------------------------------------------------------
   Adds to the Phase 0 logger:
     1. Temperature/humidity COMPENSATION for all 4 MQ channels,
        fitted from a 2h17m clean-air baseline run (sealed 650mL
        chamber, no gas, no airflow, ambient room, 2026-06-23).
        Linear model: V_comp = V_raw - (a*T + b*RH + c)
        This removes the thermal/humidity drift that dominated
        the raw signal (R^2 0.93-0.99 in the baseline fit) so
        what remains is closer to actual gas-driven signal.
     2. SPIKE REJECTION: the baseline run showed a recurring glitch
        where all 4 MQ channels jump together for one or two
        cycles (~every 5 min, 13.8% of rows) - almost certainly an
        electrical/timing artifact, not gas. This firmware takes
        TWO quick ADC reads per channel per cycle and rejects the
        reading (re-reads once) if a channel jumps too far from
        its own short-term rolling average - logged with a flag
        rather than silently dropped, so nothing is hidden.
     3. SESSION-START MARKER: the device is intentionally power-
        cycled, not left running continuously, so gaps in the data
        are normal/expected. The first row logged after every boot
        carries session_start=1, so the dashboard can tell "was
        powered off" apart from "was supposed to be running and
        silently stopped".
     4. CALIBRATE MODE: a separate, manual, clean-air-only mode
        (hold the onboard BOOT button for 2s at boot) that re-fits
        just the per-channel INTERCEPT (not the slopes - one short
        session isn't enough data to trust a slope re-estimate)
        against current room conditions, so the unit can move
        between rooms/labs without the original room's "clean air"
        baked in as a permanent error. See runCalibrateMode() below
        for the full explanation. This is NEVER automatic/silent -
        auto-calibrating in the background would risk learning an
        elevated gas reading as the new "normal" and erasing the
        signal entirely.

   Reads gas + environment sensors, timestamps them, shows a
   live summary on the LCD, saves a fail-safe CSV to the SD card,
   and pushes each sample to Google Sheets over WiFi.

   WIRING
     I2C  (SDA 21 / SCL 22) : ADS1115 (0x48), DS3231 (0x68), LCD (0x27)
     UART2 (RX 16 / TX 17)  : HC8 CO2 Sensor
     VSPI                   : SD  CS=5, SCK=18, MISO=19, MOSI=23
     GPIO4                  : DHT22 data (10k pull-up to 3.3V)
     GPIO0                  : onboard BOOT button (already wired on the
                               devkit - no new wiring) - hold at boot for
                               CALIBRATE mode
     ADS1115  A0=MQ4#1  A1=MQ4#2  A2=MQ8#1  A3=MQ8#2

   IMPORTANT - SEALED CHAMBER THERMAL NOTE:
   With no fan/airflow and only an empty in/out tube, the 650mL
   chamber has no way to shed the heat its own MQ heaters and
   electronics generate. In the baseline run, temperature climbed
   steadily for 2h17m with NO sign of leveling off - it may not
   reach a stable plateau for many hours. Before a real/IWK run,
   either: (a) power it on well in advance (longer than 2-3h) and
   confirm temp_c has flattened in the Serial/Sheets log before
   trusting readings, or (b) add a small passive vent so the
   chamber can reach thermal equilibrium faster. The compensation
   formula corrects for temperature mathematically, but it was
   only fitted across 33.3-35.0C / 53-59%RH (or whatever range
   CALIBRATE mode most recently observed - see calib_epoch in the
   logged data) - extrapolating far outside that range is less
   trustworthy. Run CALIBRATE mode again with a fresh baseline if
   conditions differ a lot from the currently active range.

   IMPORTANT: the ESP32 WiFi radio is 2.4GHz ONLY. If your router's
   SSID is the 5GHz band (e.g. "Name_5Ghz" or "Name_5G"), the board
   physically cannot see it and will time out forever. Connect it to
   the 2.4GHz SSID instead.
   ============================================================ */

#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <SD.h>
#include <Adafruit_ADS1X15.h>
#include <RTClib.h>
#include <LiquidCrystal_I2C.h>
#include "DHT.h"

// ----------------- USER CONFIG -----------------
const char* WIFI_SSID  = "iwrc@unifi";   // <-- set this to your 2.4GHz SSID, NOT the _5Ghz one
const char* WIFI_PASS  = "iwrc2024";
const String GSCRIPT_URL = "https://script.google.com/macros/s/AKfycbzTRJwlj0G1oX9G0jRpZ2_RCCS1FvcP10AfxoJi357UrcCYfIxduje-e-CgE2sFysgl/exec";
const unsigned long LOG_INTERVAL_MS = 30000UL;   // 30 s between samples
const unsigned long WIFI_RETRY_MS   = 10000UL;   // how often to retry a dropped link

// CALIBRATE mode config
const unsigned long CALIB_DURATION_MS = 20UL * 60UL * 1000UL; // 20 min, clean air only
const unsigned long CALIB_SAMPLE_MS   = 5000UL;                // sample every 5s during calibration
#define CALIB_BUTTON_PIN 0          // onboard BOOT button, active LOW
const char* CALIB_FILE = "/calib.cfg";
// -----------------------------------------------

#define DHTPIN   4
#define DHTTYPE  DHT22
#define SD_CS    5

Adafruit_ADS1115   ads;
RTC_DS3231         rtc;
LiquidCrystal_I2C  lcd(0x27, 16, 2);
DHT                dht(DHTPIN, DHTTYPE);

const char* LOG_FILE   = "/biogas_log.csv";
const char* CSV_HEADER =
  "timestamp,"
  "mq4_1_raw,mq4_2_raw,mq8_1_raw,mq8_2_raw,"
  "mq4_1_comp,mq4_2_comp,mq8_1_comp,mq8_2_comp,"
  "co2_ppm,temp_c,humidity_pct,spike_flag,"
  "session_start,calib_epoch,"
  "calib_temp_min_c,calib_temp_max_c,calib_hum_min_pct,calib_hum_max_pct";

unsigned long lastLog = 0;
unsigned long lastWifiAttempt = 0;
int lcdScreen = 0;   // 0,1,2 - rotates through 3 simple operator-facing screens

// 1 on the FIRST row logged after this boot, 0 on every row after that. Lets
// the dashboard tell "device was power-cycled" (gap immediately followed by
// a boot marker - normal) apart from "was supposed to be running and
// silently stopped" (gap with no marker - actually concerning).
bool firstRowThisBoot = true;

// ---- rolling short-term average per channel, for spike detection ----
// Seeded on the first good reading, then slowly tracks (not instant-following,
// so a real gradual gas trend is NOT mistaken for a spike).
float rollAvg[4] = {NAN, NAN, NAN, NAN};
const float ROLL_ALPHA = 0.15;       // smoothing factor for the rolling average
const float SPIKE_THRESHOLD_V = 0.02; // jump beyond this from rollAvg = suspect

// ---------- Temperature/Humidity compensation coefficients ----------
// V_comp = V_raw - (a*T + b*RH + c)
struct CompCoef { float a, b, c; };

// Lab-fit defaults - the original 2h17m clean-air baseline, 2026-06-23.
// These are the fallback when no CALIBRATE run has been saved yet, and they
// are ALWAYS the source of 'a' and 'b' (the temperature/humidity SLOPE
// coefficients - sensor chemistry, relatively stable). CALIBRATE mode never
// touches a/b, only the intercept 'c' (see runCalibrateMode()).
const CompCoef LAB_FIT_MQ4_1 = {-0.002845f, -0.002652f,  0.8075f};
const CompCoef LAB_FIT_MQ4_2 = {-0.026595f, -0.001630f,  1.8210f};
const CompCoef LAB_FIT_MQ8_1 = { 0.011209f, -0.000938f, -0.1267f};
const CompCoef LAB_FIT_MQ8_2 = {-0.007898f, -0.003230f,  0.6953f};
const float LAB_FIT_TEMP_MIN_C   = 33.3f, LAB_FIT_TEMP_MAX_C   = 35.0f;
const float LAB_FIT_HUM_MIN_PCT  = 53.0f, LAB_FIT_HUM_MAX_PCT  = 59.0f;
const char* LAB_FIT_EPOCH = "lab-fit-2026-06-23";

// Active coefficients actually used by compensate() each cycle. Start as the
// lab fit; loadCalibration() may override the intercepts + epoch + observed
// range below if /calib.cfg exists on the SD card (written by a previous
// CALIBRATE mode run - see runCalibrateMode()).
CompCoef activeMQ4_1 = LAB_FIT_MQ4_1;
CompCoef activeMQ4_2 = LAB_FIT_MQ4_2;
CompCoef activeMQ8_1 = LAB_FIT_MQ8_1;
CompCoef activeMQ8_2 = LAB_FIT_MQ8_2;
String activeEpoch    = LAB_FIT_EPOCH;
float  activeTempMinC = LAB_FIT_TEMP_MIN_C,  activeTempMaxC = LAB_FIT_TEMP_MAX_C;
float  activeHumMinPct = LAB_FIT_HUM_MIN_PCT, activeHumMaxPct = LAB_FIT_HUM_MAX_PCT;

float compensate(float vRaw, const CompCoef &k, float tempC, float hum) {
  float predicted = k.a * tempC + k.b * hum + k.c;
  return vRaw - predicted;
}

// ---------- Relative "% of sensor range" for the LCD only ----------
// NOTE: this is NOT a calibrated gas-concentration percentage - we don't have
// an IWK-validated voltage->ppm curve for the MQ sensors yet. It's a simple,
// honest "how high is this reading relative to where this sensor type
// typically operates" indicator for a quick on-site glance, clamped 0-100%.
// MQ4_FULLSCALE_V / MQ8_FULLSCALE_V are the compensated-voltage swing we've
// observed/expect this sensor type to span from clean-air to a strong signal;
// adjust these as real calibration data comes in.
const float MQ4_FULLSCALE_V = 0.30f;   // compensated volts at "high" methane signal
const float MQ8_FULLSCALE_V = 0.30f;   // compensated volts at "high" hydrogen signal

float voltsToPercent(float vComp, float fullScaleV) {
  if (isnan(vComp)) return -1;
  float pct = (vComp / fullScaleV) * 100.0f;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

// ---------- ADS1115 read with spike rejection (forward-declared - used by
// both the normal loop() and runCalibrateMode()) ----------
float readChannelFiltered(uint8_t adsChannel, int rollIdx, bool &spikeFlagOut);

// ---------- calibration persistence ----------
// Simple "key=value" text file - matches the rest of this sketch's style
// (no JSON library is used anywhere else, so this doesn't add one either).
void loadCalibration() {
  if (!SD.exists(CALIB_FILE)) {
    Serial.println("[i] No calibration file found - using lab-fit defaults");
    return;
  }
  File f = SD.open(CALIB_FILE, FILE_READ);
  if (!f) {
    Serial.println("[!] Calibration file exists but couldn't be opened - using lab-fit defaults");
    return;
  }

  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    int eq = line.indexOf('=');
    if (eq < 0) continue;
    String key = line.substring(0, eq);
    String val = line.substring(eq + 1);
    val.trim();

    if      (key == "epoch")    activeEpoch     = val;
    else if (key == "c_mq4_1")  activeMQ4_1.c   = val.toFloat();
    else if (key == "c_mq4_2")  activeMQ4_2.c   = val.toFloat();
    else if (key == "c_mq8_1")  activeMQ8_1.c   = val.toFloat();
    else if (key == "c_mq8_2")  activeMQ8_2.c   = val.toFloat();
    else if (key == "temp_min") activeTempMinC  = val.toFloat();
    else if (key == "temp_max") activeTempMaxC  = val.toFloat();
    else if (key == "hum_min")  activeHumMinPct = val.toFloat();
    else if (key == "hum_max")  activeHumMaxPct = val.toFloat();
  }
  f.close();

  Serial.print("[i] Loaded calibration from "); Serial.print(CALIB_FILE);
  Serial.print(" - epoch="); Serial.println(activeEpoch);
}

// ---------- CALIBRATE mode ----------
// Manual, deliberate, clean-air-ONLY recalibration. Never runs automatically
// or silently - it is only entered by holding the onboard BOOT button for
// the first 2 seconds after boot (see setup()). This is intentional: an
// always-on auto-calibration would, by definition, learn whatever the sensor
// is currently reading as the new "zero" - including a real elevated gas
// reading, which would erase exactly the signal this whole device exists to
// detect. CALIBRATE mode only ever runs when a human has just put the unit
// in known clean air and pressed the button to say so.
//
// It re-fits ONLY the intercept 'c' per channel, keeping the existing a/b
// (temperature/humidity slope - sensor chemistry, assumed stable across
// rooms). A single ~20-minute session is nowhere near enough data to trust a
// fresh slope estimate (the original lab fit used 2h17m); but solving for
// just the one intercept that zeroes the mean residual is a well-posed,
// low-data problem:
//   V_comp = V_raw - (a*T + b*RH + c),  want mean(V_comp) = 0 in clean air
//   =>  c = mean(V_raw) - a*mean(T) - b*mean(RH)
void runCalibrateMode() {
  Serial.println("=== ENTERING CALIBRATE MODE ===");
  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("** CALIBRATE **");
  lcd.setCursor(0, 1); lcd.print("Clean air only!");
  delay(2000);

  // A real timestamp matters for the epoch label - try WiFi/NTP now. If this
  // fails (e.g. no WiFi where the unit currently is), the calibration VALUES
  // are still computed and saved correctly; only the recorded date label
  // might be off, using whatever the RTC currently has.
  connectWiFi();
  syncRtcFromNtp();

  double sumT = 0, sumH = 0;
  double sumRaw[4] = {0, 0, 0, 0};
  long n = 0;
  float tempMin =  1000, tempMax = -1000;
  float humMin  =  1000, humMax  = -1000;

  unsigned long startMs = millis();
  unsigned long lastSample = 0;

  while (millis() - startMs < CALIB_DURATION_MS) {
    if (millis() - lastSample >= CALIB_SAMPLE_MS) {
      lastSample = millis();

      float t = dht.readTemperature();
      float h = dht.readHumidity();
      if (!isnan(t) && !isnan(h)) {
        sumT += t; sumH += h; n++;
        if (t < tempMin) tempMin = t;
        if (t > tempMax) tempMax = t;
        if (h < humMin) humMin = h;
        if (h > humMax) humMax = h;

        // Reuse the same spike-filtered read as normal logging - the
        // electrical/timing glitch is just as present during calibration,
        // and filtering it out here means it can't skew the fitted
        // intercept even before the 20-minute average smooths it out.
        bool sp;
        sp = false; sumRaw[0] += readChannelFiltered(0, 0, sp);
        sp = false; sumRaw[1] += readChannelFiltered(1, 1, sp);
        sp = false; sumRaw[2] += readChannelFiltered(2, 2, sp);
        sp = false; sumRaw[3] += readChannelFiltered(3, 3, sp);
      }
    }

    unsigned long elapsed = millis() - startMs;
    unsigned long remaining = (CALIB_DURATION_MS > elapsed) ? (CALIB_DURATION_MS - elapsed) : 0;
    unsigned int remMin = remaining / 60000UL;
    unsigned int remSec = (remaining / 1000UL) % 60UL;

    lcd.setCursor(0, 0); lcd.print("CALIBRATING...  ");
    lcd.setCursor(0, 1);
    lcd.print("Left ");
    if (remMin < 10) lcd.print('0');
    lcd.print(remMin); lcd.print(":");
    if (remSec < 10) lcd.print('0');
    lcd.print(remSec);
    lcd.print(" n="); lcd.print(n);
    lcd.print("  ");
    delay(200);
  }

  if (n < 10) {
    Serial.println("[!] CALIBRATE: too few valid DHT samples - aborting, keeping previous calibration");
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("CALIBRATE FAILED");
    lcd.setCursor(0, 1); lcd.print("Too few samples");
    delay(3000);
    return;
  }

  float meanT = sumT / n;
  float meanH = sumH / n;
  float meanRaw[4];
  for (int i = 0; i < 4; i++) meanRaw[i] = sumRaw[i] / n;

  CompCoef newMQ4_1 = activeMQ4_1; newMQ4_1.c = meanRaw[0] - newMQ4_1.a * meanT - newMQ4_1.b * meanH;
  CompCoef newMQ4_2 = activeMQ4_2; newMQ4_2.c = meanRaw[1] - newMQ4_2.a * meanT - newMQ4_2.b * meanH;
  CompCoef newMQ8_1 = activeMQ8_1; newMQ8_1.c = meanRaw[2] - newMQ8_1.a * meanT - newMQ8_1.b * meanH;
  CompCoef newMQ8_2 = activeMQ8_2; newMQ8_2.c = meanRaw[3] - newMQ8_2.a * meanT - newMQ8_2.b * meanH;

  DateTime nowDt = rtc.now();
  char epochBuf[20];
  snprintf(epochBuf, sizeof(epochBuf), "%04d-%02d-%02d %02d:%02d:%02d",
           nowDt.year(), nowDt.month(), nowDt.day(),
           nowDt.hour(), nowDt.minute(), nowDt.second());

  // FILE_WRITE truncates/overwrites - only one calibration is ever "active"
  // at a time, intentionally (older epochs already logged stay traceable via
  // the calib_epoch column on their own historical rows, even after this).
  File f = SD.open(CALIB_FILE, FILE_WRITE);
  if (!f) {
    Serial.println("[!] Could not write calibration file - NOT saved, keeping previous");
    lcd.clear();
    lcd.setCursor(0, 0); lcd.print("CALIBRATE: SD");
    lcd.setCursor(0, 1); lcd.print("write FAILED");
    delay(3000);
    return;
  }
  f.print("epoch=");    f.println(epochBuf);
  f.print("c_mq4_1=");  f.println(newMQ4_1.c, 6);
  f.print("c_mq4_2=");  f.println(newMQ4_2.c, 6);
  f.print("c_mq8_1=");  f.println(newMQ8_1.c, 6);
  f.print("c_mq8_2=");  f.println(newMQ8_2.c, 6);
  f.print("temp_min="); f.println(tempMin, 2);
  f.print("temp_max="); f.println(tempMax, 2);
  f.print("hum_min=");  f.println(humMin, 2);
  f.print("hum_max=");  f.println(humMax, 2);
  f.close();

  // Apply immediately, in-memory, for the remainder of this boot too.
  activeMQ4_1 = newMQ4_1; activeMQ4_2 = newMQ4_2;
  activeMQ8_1 = newMQ8_1; activeMQ8_2 = newMQ8_2;
  activeEpoch = String(epochBuf);
  activeTempMinC = tempMin;  activeTempMaxC = tempMax;
  activeHumMinPct = humMin;  activeHumMaxPct = humMax;

  Serial.println("=== CALIBRATE COMPLETE ===");
  Serial.print("epoch=");   Serial.println(activeEpoch);
  Serial.print("c_mq4_1="); Serial.println(newMQ4_1.c, 6);
  Serial.print("c_mq4_2="); Serial.println(newMQ4_2.c, 6);
  Serial.print("c_mq8_1="); Serial.println(newMQ8_1.c, 6);
  Serial.print("c_mq8_2="); Serial.println(newMQ8_2.c, 6);
  Serial.print("observed range: "); Serial.print(tempMin); Serial.print("-"); Serial.print(tempMax);
  Serial.print("C / "); Serial.print(humMin); Serial.print("-"); Serial.print(humMax); Serial.println("%RH");

  lcd.clear();
  lcd.setCursor(0, 0); lcd.print("CALIBRATE DONE");
  lcd.setCursor(0, 1); lcd.print("Resuming normal");
  delay(3000);
}

// ---------- setup ----------
void setup() {
  Serial.begin(115200);
  delay(200);
  Wire.begin(21, 22);
  Serial2.begin(9600, SERIAL_8N1, 16, 17);     // HC8 CO2 Sensor

  lcd.init();  lcd.backlight();
  lcd.print("Biogas Logger");
  lcd.setCursor(0, 1); lcd.print("Phase 1 boot...");

  dht.begin();

  if (!ads.begin())  Serial.println("[!] ADS1115 not found");
  ads.setGain(GAIN_ONE);                        // +/-4.096V, safe for 0-3.3V swing

  if (!rtc.begin())  Serial.println("[!] DS3231 not found");
  if (rtc.lostPower()) {
    // Only happens on first-ever power-up or after the RTC backup battery dies.
    // This compile-time fallback gets you roughly-correct time so logging
    // doesn't break before WiFi/NTP can take over a few lines below - it is
    // NOT relied on as the ongoing source of truth anymore.
    Serial.println("[i] RTC lost power - using compile time as a rough fallback");
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  if (!SD.begin(SD_CS)) {
    Serial.println("[!] SD init failed");
  } else if (!SD.exists(LOG_FILE)) {
    File f = SD.open(LOG_FILE, FILE_WRITE);
    if (f) { f.println(CSV_HEADER); f.close(); }
  }

  loadCalibration();   // override lab-fit intercepts/epoch/range if a saved calibration exists

  // ---- CALIBRATE mode gate ----
  // Hold the onboard BOOT button (GPIO0, active LOW) for the first 2s after
  // boot to enter CALIBRATE mode instead of normal logging. Released even
  // briefly during that window cancels it - this is a deliberate, sustained
  // gesture, not something a momentary bump can trigger by accident.
  pinMode(CALIB_BUTTON_PIN, INPUT_PULLUP);
  lcd.setCursor(0, 1); lcd.print("Hold BOOT=CALIB ");
  bool calibRequested = true;
  unsigned long holdStart = millis();
  while (millis() - holdStart < 2000) {
    if (digitalRead(CALIB_BUTTON_PIN) != LOW) { calibRequested = false; break; }
    delay(50);
  }
  if (calibRequested) {
    runCalibrateMode();
  }

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    syncRtcFromNtp();    // re-syncs the DS3231 to real time on every boot
  }
  delay(1500);
  lcd.clear();
}

// ---------- NTP time sync ----------
// Fetches accurate UTC+offset time over the internet and writes it to the
// DS3231 so the RTC is corrected every boot, instead of drifting further
// from a single compile-time guess made once at first power-up.
void syncRtcFromNtp() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[!] No WiFi - skipping NTP sync, RTC keeps its current time");
    return;
  }

  // UTC+8 for Malaysia (8*3600 seconds), no daylight saving offset needed.
  configTime(8 * 3600, 0, "pool.ntp.org", "time.nist.gov");

  struct tm timeinfo;
  Serial.print("Syncing time via NTP");
  unsigned long t = millis();
  bool got = false;
  while (millis() - t < 10000) {           // try for up to 10s
    if (getLocalTime(&timeinfo, 1000)) { got = true; break; }
    Serial.print(".");
  }

  if (!got) {
    Serial.println(" FAILED - keeping existing RTC time (check WiFi/internet)");
    return;
  }

  DateTime ntpTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                    timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
  rtc.adjust(ntpTime);

  char buf[20];
  DateTime check = rtc.now();
  snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d",
           check.year(), check.month(), check.day(),
           check.hour(), check.minute(), check.second());
  Serial.print(" OK -> RTC set to "); Serial.println(buf);
}


// ---------- WiFi ----------
void printWifiStatus(wl_status_t s) {
  switch (s) {
    case WL_NO_SSID_AVAIL:  Serial.println("-> SSID not found (check name / 2.4GHz band)"); break;
    case WL_CONNECT_FAILED: Serial.println("-> Connect failed (check password)"); break;
    case WL_DISCONNECTED:   Serial.println("-> Disconnected"); break;
    case WL_IDLE_STATUS:    Serial.println("-> Idle/timeout (router out of range or busy)"); break;
    default:                Serial.print("-> status code "); Serial.println((int)s); break;
  }
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.disconnect(true);
  delay(100);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to "); Serial.print(WIFI_SSID);
  unsigned long t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) {
    delay(400); Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(" connected, IP "); Serial.println(WiFi.localIP());
  } else {
    Serial.println(" FAILED");
    printWifiStatus(WiFi.status());
  }
}

void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiAttempt < WIFI_RETRY_MS) return;
  lastWifiAttempt = millis();
  connectWiFi();
}

// ---------- HC8 CO2 read (Custom Protocol) ----------
int readCO2() {
  while (Serial2.available()) Serial2.read();
  unsigned long start = millis();
  while (millis() - start < 2000) {
    if (Serial2.available() > 0 && Serial2.read() == 0x42) {
      unsigned long wait = millis();
      while (Serial2.available() < 15 && millis() - wait < 100) { }
      if (Serial2.available() >= 15) {
        byte resp[16];
        resp[0] = 0x42;
        Serial2.readBytes(&resp[1], 15);
        if (resp[1] == 0x4D) {
          return resp[6] * 256 + resp[7];
        }
      }
    }
  }
  return -1;
}

// ---------- ADS1115 read with spike rejection ----------
// Reads a channel; if it deviates from the channel's rolling average by more
// than SPIKE_THRESHOLD_V, re-reads once after a short settle delay. If the
// second read agrees with the first (i.e. it's a real fast change, not a
// one-shot glitch), it's accepted but flagged. If the second read instead
// agrees with the rolling average, the glitch is discarded and the rolling
// average is used/logged instead, with the row flagged.
float readChannelFiltered(uint8_t adsChannel, int rollIdx, bool &spikeFlagOut) {
  float v1 = ads.computeVolts(ads.readADC_SingleEnded(adsChannel));

  if (isnan(rollAvg[rollIdx])) {       // first-ever reading: seed and accept
    rollAvg[rollIdx] = v1;
    return v1;
  }

  float dev1 = fabs(v1 - rollAvg[rollIdx]);
  if (dev1 <= SPIKE_THRESHOLD_V) {
    rollAvg[rollIdx] = ROLL_ALPHA * v1 + (1 - ROLL_ALPHA) * rollAvg[rollIdx];
    return v1;
  }

  // Suspect spike - re-read after a brief settle
  delay(50);
  float v2 = ads.computeVolts(ads.readADC_SingleEnded(adsChannel));
  float dev2 = fabs(v2 - rollAvg[rollIdx]);

  if (dev2 <= SPIKE_THRESHOLD_V) {
    // Second read landed back near normal -> v1 was a transient glitch.
    // Use the rolling average for this cycle instead of the glitch value.
    spikeFlagOut = true;
    return rollAvg[rollIdx];
  } else {
    // Second read confirms the jump -> treat as a real (fast) change.
    rollAvg[rollIdx] = ROLL_ALPHA * v2 + (1 - ROLL_ALPHA) * rollAvg[rollIdx];
    return v2;
  }
}

// ---------- main loop ----------
void loop() {
  ensureWifi();

  if (lastLog != 0 && millis() - lastLog < LOG_INTERVAL_MS) return;
  lastLog = millis();

  DateTime now = rtc.now();
  char ts[20] = "YYYY-MM-DD hh:mm:ss";
  now.toString(ts);

  // ---- environment first: compensation needs temp/hum ----
  float tempC = dht.readTemperature();
  float hum   = dht.readHumidity();
  if (isnan(tempC)) tempC = -1;
  if (isnan(hum))   hum   = -1;

  // ---- gas sensors, filtered ----
  bool anySpike = false;
  bool sp;
  sp = false; float r0 = readChannelFiltered(0, 0, sp); anySpike |= sp;  // MQ-4 #1
  sp = false; float r1 = readChannelFiltered(1, 1, sp); anySpike |= sp;  // MQ-4 #2
  sp = false; float r2 = readChannelFiltered(2, 2, sp); anySpike |= sp;  // MQ-8 #1
  sp = false; float r3 = readChannelFiltered(3, 3, sp); anySpike |= sp;  // MQ-8 #2

  // ---- compensation (only meaningful if temp/hum are valid) ----
  // Uses activeMQ4_1 etc - the lab-fit defaults unless a CALIBRATE run has
  // overridden the intercepts (loadCalibration() in setup()).
  float c0, c1, c2, c3;
  if (tempC > -90 && hum > -90) {
    c0 = compensate(r0, activeMQ4_1, tempC, hum);
    c1 = compensate(r1, activeMQ4_2, tempC, hum);
    c2 = compensate(r2, activeMQ8_1, tempC, hum);
    c3 = compensate(r3, activeMQ8_2, tempC, hum);
  } else {
    c0 = c1 = c2 = c3 = NAN;  // DHT failed this cycle - can't compensate, raw still logged
  }

  int co2 = readCO2();

  // ---- build CSV row: raw, compensated, env, spike flag, boot marker,
  //      and which calibration epoch + observed range was active for this
  //      row (keeps historical data traceable to its baseline even after a
  //      later recalibration). ----
  int sessionStartFlag = firstRowThisBoot ? 1 : 0;
  String row = String(ts) + "," +
               String(r0,4) + "," + String(r1,4) + "," + String(r2,4) + "," + String(r3,4) + "," +
               String(c0,4) + "," + String(c1,4) + "," + String(c2,4) + "," + String(c3,4) + "," +
               String(co2) + "," + String(tempC,1) + "," + String(hum,1) + "," +
               (anySpike ? "1" : "0") + "," +
               String(sessionStartFlag) + "," + activeEpoch + "," +
               String(activeTempMinC,1) + "," + String(activeTempMaxC,1) + "," +
               String(activeHumMinPct,1) + "," + String(activeHumMaxPct,1);
  Serial.println(row);

  File f = SD.open(LOG_FILE, FILE_APPEND);
  bool sdOk = false;
  if (f) {
    f.println(row);
    f.close();
    sdOk = true;
  } else {
    Serial.println("[!] SD WRITE FAILED this cycle - row NOT saved to card!");
  }

  String tsEnc = String(ts);
  tsEnc.replace(" ", "%20"); tsEnc.replace(":", "%3A");
  String epochEnc = activeEpoch;
  epochEnc.replace(" ", "%20"); epochEnc.replace(":", "%3A");

  bool sent = sendToSheets(tsEnc, r0, r1, r2, r3, c0, c1, c2, c3, co2, tempC, hum, anySpike,
                            sessionStartFlag, epochEnc,
                            activeTempMinC, activeTempMaxC, activeHumMinPct, activeHumMaxPct);

  firstRowThisBoot = false;   // only the very first row of this boot carries session_start=1

  updateLCD(co2, tempC, hum, c0, c2, sent, anySpike, sdOk);
}

// ---------- Google Sheets push ----------
bool sendToSheets(String tsEnc, float r0, float r1, float r2, float r3,
                  float c0, float c1, float c2, float c3,
                  int co2, float t, float h, bool spike,
                  int sessionStart, String epochEnc,
                  float tempMinC, float tempMaxC, float humMinPct, float humMaxPct) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[!] Skipping Sheets push - WiFi not connected");
    return false;
  }

  // Diagnostics: low heap or a weak/unstable link are the two most common
  // causes of a TLS handshake failing with "connection refused" on ESP32.
  Serial.print("[i] Free heap: "); Serial.print(ESP.getFreeHeap());
  Serial.print(" bytes, WiFi RSSI: "); Serial.print(WiFi.RSSI()); Serial.println(" dBm");

  // NOTE: the Apps Script webhook (GSCRIPT_URL) must also be updated to read
  // these five NEW query params and write them into the matching new sheet
  // columns - see the project README/chat notes for the exact param name ->
  // column name mapping (sess -> session_start, epoch -> calib_epoch,
  // tmin/tmax/hmin/hmax -> calib_temp_min_c/calib_temp_max_c/
  // calib_hum_min_pct/calib_hum_max_pct). Until that script is updated, these
  // params are sent but silently ignored by Sheets - harmless, but the new
  // columns won't populate.
  String url = GSCRIPT_URL + "?ts=" + tsEnc +
               "&mq4_1r=" + String(r0,4) + "&mq4_2r=" + String(r1,4) +
               "&mq8_1r=" + String(r2,4) + "&mq8_2r=" + String(r3,4) +
               "&mq4_1c=" + String(c0,4) + "&mq4_2c=" + String(c1,4) +
               "&mq8_1c=" + String(c2,4) + "&mq8_2c=" + String(c3,4) +
               "&co2="    + String(co2)  + "&temp="   + String(t,1) +
               "&hum="    + String(h,1)  + "&spike="  + (spike ? "1" : "0") +
               "&sess="   + String(sessionStart) +
               "&epoch="  + epochEnc +
               "&tmin="   + String(tempMinC,1) + "&tmax=" + String(tempMaxC,1) +
               "&hmin="   + String(humMinPct,1) + "&hmax=" + String(humMaxPct,1);

  int code = -1;
  for (int attempt = 1; attempt <= 2; attempt++) {
    WiFiClientSecure client;
    client.setInsecure();
    client.setHandshakeTimeout(15);     // seconds; default can be too short on weak links

    HTTPClient https;
    https.setConnectTimeout(8000);      // ms
    https.setTimeout(8000);

    if (!https.begin(client, url)) {
      Serial.println("[!] https.begin() failed (bad URL or client setup)");
      continue;
    }
    https.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    code = https.GET();
    Serial.print("[attempt "); Serial.print(attempt); Serial.print("] Sheets HTTP ");
    Serial.println(code);
    if (code <= 0) {
      Serial.print("[!] HTTPClient error: ");
      Serial.println(https.errorToString(code));
    }
    https.end();

    if (code > 0) break;                // success (or a real HTTP error code) - stop retrying
    delay(1500);                          // brief pause before retry on connection-level failure
  }

  return (code > 0 && code < 400);
}

// ---------- LCD: 3 simple, operator-facing screens ----------
// No decimals, no raw volts, no "compensated" jargon - this is for whoever's
// standing next to the unit when the phone/app isn't being checked, or when
// WiFi is down and they need to confirm it's still working and saving data.
//   Screen 0: CO2 in ppm AND percent
//   Screen 1: MQ4 / MQ8 relative signal level, as a percent of typical range
//   Screen 2: system status - WiFi/cloud, SD card, last update
void updateLCD(int co2, float t, float h, float mq4c, float mq8c,
               bool cloudSent, bool spike, bool sdOk) {
  lcd.clear();
  lcdScreen = (lcdScreen + 1) % 3;

  if (lcdScreen == 0) {
    float co2pct = (co2 >= 0) ? (co2 / 10000.0f) : -1;   // ppm -> % (10000ppm=1%)
    lcd.setCursor(0, 0);
    if (co2 >= 0) { lcd.print("CO2:"); lcd.print(co2); lcd.print("ppm"); }
    else            lcd.print("CO2: -- (no read)");
    lcd.setCursor(0, 1);
    if (co2pct >= 0) { lcd.print(co2pct, 1); lcd.print("%  T:"); lcd.print(t, 0); lcd.print("C"); }
    else               { lcd.print("T:"); lcd.print(t, 0); lcd.print("C H:"); lcd.print(h, 0); lcd.print("%"); }

  } else if (lcdScreen == 1) {
    float p4 = voltsToPercent(mq4c, MQ4_FULLSCALE_V);
    float p8 = voltsToPercent(mq8c, MQ8_FULLSCALE_V);
    lcd.setCursor(0, 0);
    lcd.print("MQ4 lvl:");
    if (p4 >= 0) { lcd.print((int)p4); lcd.print("%"); } else lcd.print("--");
    lcd.setCursor(0, 1);
    lcd.print("MQ8 lvl:");
    if (p8 >= 0) { lcd.print((int)p8); lcd.print("%"); } else lcd.print("--");
    if (spike) { lcd.setCursor(15, 1); lcd.print("!"); }   // ! = glitch filtered this cycle

  } else {
    lcd.setCursor(0, 0);
    lcd.print("Cloud:"); lcd.print(cloudSent ? "OK  " : "FAIL");
    lcd.print(" SD:"); lcd.print(sdOk ? "OK" : "ERR");
    lcd.setCursor(0, 1);
    lcd.print("WiFi:"); lcd.print(WiFi.status() == WL_CONNECTED ? "OK " : "OFF");
    lcd.print(" Live");
  }
}
