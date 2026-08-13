/**
 * BIOGAS ANALYZER - Google Sheets webhook (Phase 1: raw + compensated +
 * session/calibration metadata)
 * ----------------------------------------------------------------------
 * Receives data from the ESP32 over HTTP GET and appends one row.
 *
 * SETUP (run once after pasting):
 *   1. Open your Google Sheet.
 *   2. Extensions > Apps Script, delete old code, paste this.
 *   3. Deploy > Manage deployments > edit the existing deployment
 *      (or New deployment) > Web app > Execute as: Me, Access: Anyone.
 *      Re-authorize if prompted. The /exec URL stays the same if you
 *      edit the existing deployment rather than creating a new one.
 */

var REQUIRED_HEADER = [
  "timestamp",
  "mq4_1_raw", "mq4_2_raw", "mq8_1_raw", "mq8_2_raw",
  "mq4_1_comp", "mq4_2_comp", "mq8_1_comp", "mq8_2_comp",
  "co2_ppm", "temp_c", "humidity_pct", "spike_flag",
  "session_start", "calib_epoch",
  "calib_temp_min_c", "calib_temp_max_c",
  "calib_hum_min_pct", "calib_hum_max_pct",
  "calibrating", "calib_seconds_left"
];

/**
 * Returns the current header row as a flat array of strings, adding any
 * missing columns first.
 *
 * Fast path (normal operation after initial setup): the sheet already has
 * at least as many columns as REQUIRED_HEADER, so we just read the header
 * once and return it — no value comparison. This was the bottleneck on a
 * 120k+ row sheet: the old code read the header TWICE per request (once
 * here to check for missing columns, once again in doGet to build the col
 * map), costing 1–2 extra Sheets API round-trips and pushing total script
 * execution past the ESP32's 8-second timeout.
 *
 * Slow path (first deploy, or a column was accidentally removed): reads
 * all current headers, diffs, appends what's missing.
 */
function ensureHeader(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();

  if (lastRow === 0) {
    sheet.appendRow(REQUIRED_HEADER);
    return REQUIRED_HEADER.slice();
  }

  // Fast path: column count already correct — read header once and return.
  if (lastCol >= REQUIRED_HEADER.length) {
    return sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  }

  // Slow path: find and add missing columns.
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
  var newLastCol = sheet.getLastColumn();
  return sheet.getRange(1, 1, 1, newLastCol).getValues()[0];
}

function doGet(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("Data") || ss.insertSheet("Data");

    // ensureHeader() now returns the header array — reuse it directly so we
    // don't pay for a second Sheets API read just to build the col index map.
    var header = ensureHeader(sheet);
    var col = {};
    for (var k = 0; k < header.length; k++) col[String(header[k]).trim()] = k;

    var p = e.parameter;
    var ts = p.ts ? p.ts : new Date();

    // Blank (not 0, not "NaN") when a param is genuinely absent — e.g. a
    // CALIBRATE-mode ping that doesn't send sensor values.
    function numOrBlank(v) {
      return (v === undefined || v === "") ? "" : Number(v);
    }

    var values = {
      timestamp: ts,
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

    // Build the row array sized to the sheet's actual column count, placing
    // each value at its real index from `col` — not at a fixed position —
    // so a future column reorder can't corrupt data.
    var row = new Array(header.length);
    for (var name in values) {
      if (col.hasOwnProperty(name)) row[col[name]] = values[name];
    }

    // getRange+setValues is faster than appendRow() on large sheets.
    // appendRow() internally calls getLastRow() then does an insert;
    // here we call getLastRow() once and write directly to that range.
    // The script lock above prevents concurrent writes from racing.
    var nextRow = sheet.getLastRow() + 1;
    sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);

    return ContentService.createTextOutput("OK");
  } catch (err) {
    return ContentService.createTextOutput("ERROR: " + err);
  } finally {
    lock.releaseLock();
  }
}
