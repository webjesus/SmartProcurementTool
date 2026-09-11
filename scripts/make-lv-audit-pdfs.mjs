import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function syntheticPdf(lines) {
  const pages = Array.from({ length: Math.ceil(lines.length / 36) }, (_, pageIndex) =>
    lines.slice(pageIndex * 36, (pageIndex + 1) * 36)
  );
  const fontObjectId = 3 + pages.length * 2;
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    ...pages.flatMap((pageLines, index) => {
      const stream = [
        "BT",
        "/F1 11 Tf",
        "46 790 Td",
        ...pageLines
          .map((line) => line.replace(/([()\\])/g, "\\$1"))
          .flatMap((line, lineIndex) =>
            lineIndex === 0 ? [`(${line}) Tj`] : ["0 -18 Td", `(${line}) Tj`]
          ),
        "ET"
      ].join("\n");
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${pageObjectIds[index] + 1} 0 R >>`,
        `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
      ];
    }),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let value = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(value));
    value += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(value);
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    value += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  value += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(value, "ascii");
}

const outDir = path.join(process.cwd(), "tmp", "lv-design-audit");
mkdirSync(outDir, { recursive: true });

writeFileSync(
  path.join(outDir, "basis-lv-redesign.pdf"),
  syntheticPdf([
    "Angebotsaufforderung LV-Daten LV-Bezeichnung LV-Nummer 24-07 H",
    "Heizungsinstallation Inhaltsverzeichnis",
    "1.1.10. Hocheffizienz Umwaelzpumpe Heizkreis DN 25 2 St",
    "1.1.20. Absperrventil Heizkreis DN 25 1 St",
    ...Array.from({ length: 18 }, (_, index) =>
      `1.1.${(index + 3) * 10}. Zusaetzliche Armatur Heizkreis DN 25 1 St`
    )
  ])
);
writeFileSync(
  path.join(outDir, "Gienger-Angebot.pdf"),
  syntheticPdf([
    "Gienger Angebot Nr. 15875507-001 E-Preis Gesamtpreis",
    "Heizungsinstallation",
    "1.1.10 Umwaelzpumpe Heizkreis DN 25 2 St Art. GPX-2 EP 100,00 GP 200,00",
    "1.1.20 Absperrventil Heizkreis DN 25 1 St Art. GV-1 EP 28,00 GP 28,00"
  ])
);
writeFileSync(
  path.join(outDir, "P-und-M-Angebot.pdf"),
  syntheticPdf([
    "Pfeiffer & May Angebot Nr. 591528-1 Version 2 E-Preis Gesamtpreis",
    "Heizungsinstallation",
    "1.1.10 Umwaelzpumpe Heizkreis DN 25 2 St Art. PM-2 EP 90,00 GP 180,00",
    "1.1.20 Absperrventil Heizkreis DN 25 1 St Art. PMV-1 EP 30,00 GP 30,00"
  ])
);

console.log(outDir);
