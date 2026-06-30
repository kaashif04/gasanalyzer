/**
 * BIOGAS ANALYZER - Google Sheets webhook (Phase 1: raw + compensated +
 * session/calibration metadata)
 * ----------------------------------------------------------------------
 * Receives data from the ESP32 over HTTP GET and appends one row.
 * Stores raw + compensated MQ values, a spike_flag (1 = a same-cycle
 * multi-channel glitch was caught and filtered by the firmware before this
 * row was sent), a session_start flag (1 = first row logged after a fresh
 * firmware boot - lets the dashboard tell "was powered off" apart from "was
 * supposed to be running and silently stopped"), and which compensation
 * calibration (calib_epoch + its observed temp/RH range) was active when
 * this row was logged. Also accepts periodic "calibrating" status pings
 * sent WHILE a CALIBRATE run is in progress (calibrating=1, most other
 * columns blank) so the dashboard can show that instead of misreading the
 * 20-minute gap as the device being offline.
 *
 * SETUP (same as before - re-deploy after pasting this):
 *   1. Open your Google Sheet.
 *   2. Extensions > Apps Script, delete old code, paste this.
 *   3. Deploy > Manage deployments > edit the existing deployment
 *      (or New deployment) > Web app > Execute as: Me, Access: Anyone.
 *      Re-authorize if prompted. The /exec URL stays the same if you
 *      edit the existing deployment rather than creating a new one.
 *
 * NO MANUAL HEADER EDIT NEEDED: ensureHeader() below extends an existing
 * header with any of the 6 new columns that are missing, without touching
 * or reordering whatever's already there - runs automatically on first
 * request after you redeploy. Works whether the "Data" tab is brand new or
 * already has rows under the old 13-column header.
 *
 * Every value is then written by COLUMN NAME, not a fixed position - looked
 * up fresh from the actual header each request. This means it stays correct
 * even if a column ever gets reordered, or if ensureHeader() adds the new
 * columns somewhere other than where you'd assume - nothing here relies on
 * "column 14 is always session_start" the way a plain appendRow(array) would.
 */

var REQUIRED_HEADER = [
  "timestamp",
  "mq4_1_raw", "mq4_2_raw", "mq8_1_raw", "mq8_2_raw",
  "mq4_1_comp", "mq4_2_comp", "mq8_1_comp", "mq8_2_comp",
  "co2_ppm", "temp_c", "humidity_pct", "spike_flag",
  "session_start", "calib_epoch",
  "calib_temp_min_c", "calib_temp_max_c",
  "calib_hum_min_pct", "calib_hum_max_pct",
  // Periodic status pings sent WHILE CALIBRATE mode is running - most other
  // columns are blank on these rows, see numOrBlank() below.
  "calibrating", "calib_seconds_left"
];

/** Adds any REQUIRED_HEADER columns missing from row 1, appended after
 *  whatever's already there. Never reorders or rewrites existing header
 *  cells or data. Safe to call on every request - a no-op once nothing's
 *  missing, and self-heals if a column is ever accidentally removed. */
function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(REQUIRED_HEADER);
    return;
  }

  var lastCol = sheet.getLastColumn();
  var existing = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var existingSet = {};
  for (var i = 0; i < existing.length; i++) {
    existingSet[String(existing[i]).trim()] = true;
  }

  var missing = [];
  for (var j = 0; j < REQUIRED_HEADER.length; j++) {
    if (!existingSet[REQUIRED_HEADER[j]]) missing.push(REQUIRED_HEADER[j]);
  }

  if (missing.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
}

function doGet(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Data") || ss.insertSheet("Data");

    ensureHeader(sheet);

    // Re-read the header fresh (covers both the brand-new and just-extended
    // cases) and map name -> column index, so values land in the RIGHT
    // columns regardless of order.
    var header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var col = {};
    for (var k = 0; k < header.length; k++) col[String(header[k]).trim()] = k;

    var p = e.parameter;
    var ts = p.ts ? p.ts : new Date();

    // Blank (not 0, not the string "NaN") when a param is genuinely absent -
    // e.g. if older firmware that doesn't send these yet ever calls this
    // newer script. Matches how the dashboard backend already treats a
    // missing/blank cell for every other optional column.
    function numOrBlank(v) {
      return (v === undefined || v === "") ? "" : Number(v);
    }

    var values = {
      timestamp: ts,
      // numOrBlank (not Number()) for every sensor field, since a
      // CALIBRATE-mode status ping sends none of these - they should land
      // as blank cells, not 0 or the literal string "NaN".
      mq4_1_raw: numOrBlank(p.mq4_1r), mq4_2_raw: numOrBlank(p.mq4_2r),
      mq8_1_raw: numOrBlank(p.mq8_1r), mq8_2_raw: numOrBlank(p.mq8_2r),
      mq4_1_comp: numOrBlank(p.mq4_1c), mq4_2_comp: numOrBlank(p.mq4_2c),
      mq8_1_comp: numOrBlank(p.mq8_1c), mq8_2_comp: numOrBlank(p.mq8_2c),
      co2_ppm: numOrBlank(p.co2),
      temp_c: numOrBlank(p.temp), humidity_pct: numOrBlank(p.hum),
      spike_flag: Number(p.spike) || 0,
      session_start: Number(p.sess) || 0,
      calib_epoch: p.epoch || "",
      calib_temp_min_c: numOrBlank(p.tmin), calib_temp_max_c: numOrBlank(p.tmax),
      calib_hum_min_pct: numOrBlank(p.hmin), calib_hum_max_pct: numOrBlank(p.hmax),
      calibrating: Number(p.calib) || 0,
      calib_seconds_left: numOrBlank(p.secleft)
    };

    // Build the row sized to the sheet's actual current column count,
    // placing each value at its real column index from `col` - not at a
    // fixed position assumed to match REQUIRED_HEADER's order.
    var row = new Array(header.length);
    for (var name in values) {
      if (col.hasOwnProperty(name)) row[col[name]] = values[name];
    }

    sheet.appendRow(row);

    return ContentService.createTextOutput("OK");
  } catch (err) {
    return ContentService.createTextOutput("ERROR: " + err);
  } finally {
    lock.releaseLock();
  }
}
