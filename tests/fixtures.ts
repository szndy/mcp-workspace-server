import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

/** Builds a masterlist workbook with the same layout as the real one, filled with obviously fake data. */
export async function writeSampleMasterlist(file: string, count = 12): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.mergeCells('A1:E1');
  const title = ws.getCell('A1');
  title.value = 'SAMPLE CLASS MASTERLIST';
  title.alignment = { horizontal: 'center' };
  title.font = { name: 'Calibri', size: 11, bold: true };

  const header = ws.getRow(2);
  ['#', 'TUPM-ID', 'last_name', 'first_name', 'middle_name'].forEach((text, i) => {
    const cell = header.getCell(i + 1);
    cell.value = text;
    cell.font = { name: 'Calibri', size: 11, bold: true };
    cell.alignment = { horizontal: 'center' };
  });

  for (let i = 1; i <= count; i++) {
    const n = String(i).padStart(2, '0');
    const row = ws.getRow(i + 2);
    row.values = [i, `TUPM-24-${String(1000 + i)}`, `Lastname${n}`, `Firstname${n}`, `Middle${n}`];
    for (let c = 1; c <= 5; c++) {
      const cell = row.getCell(c);
      cell.font = { name: 'Calibri', size: 11 };
      cell.alignment = { horizontal: c === 1 ? 'center' : 'left' };
      cell.border = { bottom: { style: 'thin' } };
    }
  }
  [6.9, 13.1, 17.7, 14.1, 14.1].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await wb.xlsx.writeFile(file);
}
