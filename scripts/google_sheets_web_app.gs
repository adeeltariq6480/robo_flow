// Paste this into Extensions -> Apps Script inside the target Google Sheet.
// Change this value and use the same value as GOOGLE_SHEETS_WEBHOOK_SECRET on Railway.
const WEBHOOK_SECRET = "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET";
const BLUE_SEPARATOR = "#4a86e8";

function normalizeTitle(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findSheet(category) {
  const aliases = category === "similar" ? ["similar", "silmair"] : ["fakebarcode"];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets().find(function (candidate) {
    const title = normalizeTitle(candidate.getName());
    return aliases.some(function (alias) { return title.indexOf(alias) !== -1; });
  });
  if (!sheet) throw new Error(category === "similar" ? "Similar tab not found" : "Fake Barcode tab not found");
  return sheet;
}

function fileDate() {
  for (let i = 0; i < arguments.length; i += 1) {
    const match = String(arguments[i] || "").match(/(?:^|\D)(20\d{2})[-_](\d{2})[-_](\d{2})(?:\D|$)/);
    if (match) return Number(match[2]) + "/" + Number(match[3]) + "/" + match[1];
  }
  return "";
}

function percent(value) {
  const text = String(value == null ? "" : value).trim();
  return !text || text.endsWith("%") ? text : text + "%";
}

function lastSavedDate(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "";
  const values = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = String(values[i][0] || "").trim();
    if (value && value.toLowerCase() !== "date") return value;
  }
  return "";
}

function doPost(event) {
  try {
    const body = JSON.parse((event.postData && event.postData.contents) || "{}");
    if (!WEBHOOK_SECRET || body.secret !== WEBHOOK_SECRET) throw new Error("Invalid webhook secret");
    if (["similar", "fake"].indexOf(body.category) === -1) throw new Error("Invalid category");
    if (!Array.isArray(body.items) || !body.items.length) throw new Error("No images selected");

    const sheet = findSheet(body.category);
    const width = body.category === "similar" ? 6 : 4;
    let previousDate = lastSavedDate(sheet);

    body.items.forEach(function (item) {
      const date = body.category === "similar"
        ? fileDate(item.result_url, item.similar_url)
        : fileDate(item.image_url);
      if (date && date !== previousDate) {
        sheet.appendRow(new Array(width).fill(""));
        sheet.getRange(sheet.getLastRow(), 1, 1, width).setBackground(BLUE_SEPARATOR);
        previousDate = date;
      }
      const row = body.category === "similar"
        ? [date, item.image_id || "", item.result_url || "", item.similar_url || "", percent(item.csv_score), "Done"]
        : [date, item.image_id || "", item.image_url || "", "Done"];
      sheet.appendRow(row);
    });

    return ContentService.createTextOutput(JSON.stringify({ok: true, added: body.items.length, tab: sheet.getName()}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ok: false, error: String(error.message || error)}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
