import { describe, expect, it } from "vitest";
import {
  findPdfPositionMarkers,
  locatePdfSourceRegion,
  padPdfSourceRegion,
  pdfTextInVisualOrder
} from "@/pdf/source-region";

function item(str: string, x: number, baselineY: number, width: number, height = 12) {
  return {
    str,
    width,
    height,
    transform: [1, 0, 0, height, x, baselineY]
  };
}

type ViewportMatrix = readonly [number, number, number, number, number, number];

function viewportItem(
  str: string,
  left: number,
  top: number,
  width: number,
  height: number,
  viewportTransform: ViewportMatrix
) {
  const [a, b, c, d, e, f] = viewportTransform;
  const determinant = a * d - b * c;
  const inverseVector = (x: number, y: number): [number, number] => [
    (d * x - c * y) / determinant,
    (-b * x + a * y) / determinant
  ];
  const inversePoint = (x: number, y: number): [number, number] => {
    const [pointX, pointY] = inverseVector(x - e, y - f);
    return [pointX, pointY];
  };
  const [horizontalX, horizontalY] = inverseVector(1, 0);
  const [verticalX, verticalY] = inverseVector(0, -height);
  const [originX, originY] = inversePoint(left, top + height);

  return {
    str,
    width,
    height,
    transform: [horizontalX, horizontalY, verticalX, verticalY, originX, originY]
  };
}

describe("PDF source region", () => {
  it("selects product and metadata rows preceding a trailing bare LV marker", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("Artikel Beschreibung", 95, 720, 150, 10),
        item("Menge", 350, 720, 45, 10),
        item("Preis", 510, 720, 38, 10),
        item("Pruefventil Delta", 95, 660, 125, 10),
        item("6 ST", 350, 660, 28, 10),
        item("84,00", 510, 660, 42, 10),
        item("Werkstoff Rotguss", 95, 635, 125, 10),
        item("1.1.10. Stat. WarenNr DEMO-A", 55, 600, 190, 10),
        item("Nachbarprodukt Sigma", 95, 550, 140, 10),
        item("2 ST", 350, 550, 28, 10),
        item("35,00", 510, 550, 42, 10),
        item("1.1.20. Stat. WarenNr DEMO-B", 55, 500, 190, 10)
      ],
      positionNumber: "1.1.10",
      description: "Pruefventil Delta Werkstoff Rotguss"
    });

    expect(region).not.toBeNull();
    expect(region?.x).toBeCloseTo(55 / 600, 5);
    expect(region?.y).toBeCloseTo((800 - 670) / 800, 5);
    expect((region?.x ?? 0) + (region?.width ?? 0)).toBeCloseTo(552 / 600, 5);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeCloseTo((800 - 600) / 800, 5);
  });

  it("keeps a trailing-marker block between neighboring products", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("Vorheriges Pruefmodul", 95, 690, 150, 10),
        item("4 ST", 350, 690, 28, 10),
        item("1.1.10. Stat. WarenNr DEMO-A", 55, 640, 190, 10),
        item("Zielkupplung Omega", 95, 580, 140, 10),
        item("8 ST", 350, 580, 28, 10),
        item("126,00", 510, 580, 42, 10),
        item("Ausfuehrung komplett", 95, 550, 145, 10),
        item("1.1.20. Stat. WarenNr DEMO-B", 55, 520, 190, 10),
        item("Folgeprodukt Kappa", 95, 465, 135, 10),
        item("1.1.30. Stat. WarenNr DEMO-C", 55, 420, 190, 10)
      ],
      positionNumber: "1.1.20",
      description: "Zielkupplung Omega Ausfuehrung komplett"
    });

    expect(region).not.toBeNull();
    expect(region?.y).toBeCloseTo((800 - 590) / 800, 5);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeCloseTo((800 - 520) / 800, 5);
  });

  it("treats PME metadata as a trailing bare LV marker", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("Vorheriges Modul", 95, 700, 120, 10),
        item("2 ST", 350, 700, 28, 10),
        item("1.1.10. PME A-100", 55, 660, 120, 10),
        item("Zielventil Omega", 95, 610, 125, 10),
        item("6 ST", 350, 610, 28, 10),
        item("84,00", 510, 610, 42, 10),
        item("Werkstoff komplett", 95, 585, 135, 10),
        item("1.1.20. PME B-200", 55, 550, 120, 10),
        item("Folgemodul Sigma", 95, 500, 125, 10),
        item("4 ST", 350, 500, 28, 10),
        item("1.1.30. PME C-300", 55, 460, 120, 10)
      ],
      positionNumber: "1.1.20",
      description: "Zielventil Omega Werkstoff komplett"
    });

    expect(region).not.toBeNull();
    expect(region?.y).toBeCloseTo((800 - 620) / 800, 5);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeCloseTo((800 - 550) / 800, 5);
  });

  it("keeps the padded frame above an overlapping next-position glyph box", () => {
    const nextMarkerTop = (800 - (524 + 10)) / 800;
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("1.1.10", 55, 650, 45, 10),
        item("Zielmodul Alpha", 95, 620, 115, 10),
        item("Technische Abschlusszeile", 95, 530, 170, 20),
        item("1.1.20", 55, 524, 45, 10),
        item("Nachbarmodul Beta", 95, 490, 130, 10)
      ],
      positionNumber: "1.1.10",
      description: "Zielmodul Alpha Technische Abschlusszeile"
    });
    const padded = region ? padPdfSourceRegion(region) : null;

    expect(padded).not.toBeNull();
    expect((padded?.y ?? 0) + (padded?.height ?? 0)).toBeLessThanOrEqual(nextMarkerTop);
  });

  it("stops at the next single-column position when its marker is moderately indented", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("4.2.10", 55, 650, 45, 10),
        item("Prüfbauteil Alpha", 150, 650, 115, 10),
        item("Technische Kenngröße", 150, 610, 135, 10),
        item("4.2.20", 132, 500, 45, 10),
        item("Prüfbauteil Beta", 220, 500, 110, 10)
      ],
      positionNumber: "4.2.10",
      description: "Prüfbauteil Alpha Technische Kenngröße"
    });

    expect(region).not.toBeNull();
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.3);
  });

  it.each([
    {
      rotation: 0,
      pageWidth: 600,
      pageHeight: 800,
      viewportTransform: [1, 0, 0, -1, -10, 820] as const
    },
    {
      rotation: 90,
      pageWidth: 800,
      pageHeight: 600,
      viewportTransform: [0, 1, 1, 0, -20, -10] as const
    },
    {
      rotation: 180,
      pageWidth: 600,
      pageHeight: 800,
      viewportTransform: [-1, 0, 0, 1, 610, -20] as const
    },
    {
      rotation: 270,
      pageWidth: 800,
      pageHeight: 600,
      viewportTransform: [0, -1, -1, 0, 820, 610] as const
    }
  ])(
    "normalizes a cropped PDF page with a $rotation-degree viewport transform",
    ({ pageWidth, pageHeight, viewportTransform }) => {
      const makeItem = (str: string, left: number, top: number, width: number) =>
        viewportItem(str, left, top, width, 10, viewportTransform);
      const region = locatePdfSourceRegion({
        pageWidth,
        pageHeight,
        viewportTransform,
        items: [
          makeItem("Position 7.3.10", 50, 80, 95),
          makeItem("Fiktives Prüfmodul", 160, 80, 140),
          makeItem("Zusätzliche Testzeile", 160, 120, 150),
          makeItem("Position 7.3.20", 50, 240, 95),
          makeItem("Nächstes Prüfmodul", 160, 240, 135)
        ],
        positionNumber: "7.3.10",
        description: "Fiktives Prüfmodul Zusätzliche Testzeile"
      });

      expect(region).not.toBeNull();
      expect(region?.x).toBeCloseTo(50 / pageWidth, 5);
      expect(region?.y).toBeCloseTo(80 / pageHeight, 5);
      expect(region?.width).toBeCloseTo(260 / pageWidth, 5);
      expect(region?.height).toBeCloseTo(50 / pageHeight, 5);
    }
  );

  it("exposes spatially ordered markers for extraction without content-stream parsing", () => {
    const markers = findPdfPositionMarkers({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("Position 1.1.20", 55, 500, 100, 10),
        item("Position", 55, 650, 45, 10),
        item("1.", 105, 650, 10, 10),
        item("1.", 120, 650, 10, 10),
        item("10", 135, 650, 12, 10)
      ]
    });

    expect(markers.map((marker) => marker.positionNumber)).toEqual(["1.1.10", "1.1.20"]);
    expect(markers[0]).toMatchObject({
      kind: "LV",
      form: "EXPLICIT",
      lineIndex: 0,
      x: 55 / 600
    });
  });

  it("deduplicates an OCR word-row containing an explicit Position label and its bare number", () => {
    const viewportTransform = [1, 0, 0, -1, 0, 800] as const;
    const items = [
      viewportItem("Position", 45, 120, 70, 18, viewportTransform),
      viewportItem("1.1.10.", 330, 120, 75, 18, viewportTransform),
      viewportItem("OCR", 420, 120, 38, 18, viewportTransform),
      viewportItem("Prüfmodul", 470, 120, 85, 18, viewportTransform),
      viewportItem("2", 560, 120, 10, 18, viewportTransform),
      viewportItem("St", 575, 120, 18, 18, viewportTransform)
    ];

    expect(
      findPdfPositionMarkers({
        pageWidth: 600,
        pageHeight: 800,
        viewportTransform,
        items
      })
    ).toEqual([
      expect.objectContaining({
        positionNumber: "1.1.10",
        kind: "LV",
        form: "EXPLICIT",
        x: expect.closeTo(45 / 600, 5)
      })
    ]);
    expect(
      locatePdfSourceRegion({
        pageWidth: 600,
        pageHeight: 800,
        viewportTransform,
        items,
        positionNumber: "1.1.10",
        description: "OCR Prüfmodul"
      })
    ).toEqual(expect.objectContaining({ width: expect.any(Number) }));
  });

  it("exposes text in visual row order for deterministic worker parsing", () => {
    expect(
      pdfTextInVisualOrder({
        pageWidth: 600,
        pageHeight: 800,
        items: [
          item("Nächste Zeile", 55, 500, 90, 10),
          item("Beschreibung", 180, 650, 80, 10),
          item("1.1.10", 55, 650, 45, 10)
        ]
      })
    ).toBe("1.1.10 Beschreibung\nNächste Zeile");
  });

  it("locates the requested supplier position instead of a similarly numbered earlier row", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("1 1 40", 70, 700, 42),
        item("nicht im Lieferprogramm", 145, 700, 150),
        item("Angebotsposition 70", 70, 500, 126),
        item("Prüfmodul Gamma Typ-X", 215, 500, 190),
        item("4 Stück", 445, 500, 48),
        item("12,34", 520, 500, 38),
        item("Angebotsposition 80", 70, 450, 126),
        item("Prüfeinheit Delta", 215, 450, 90)
      ],
      positionNumber: "1.1.70",
      supplierPositionNumber: "70",
      description: "Angebotsposition 70 Prüfmodul Gamma Typ-X"
    });

    expect(region).not.toBeNull();
    expect(region?.y).toBeCloseTo(0.36, 2);
    expect(region?.height).toBeLessThan(0.04);
    expect(region?.x).toBeCloseTo(70 / 600, 3);
    expect((region?.x ?? 0) + (region?.width ?? 0)).toBeCloseTo(558 / 600, 2);
  });

  it("recognizes a spaced LV number in the basis document", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("Position 1 1 60", 55, 620, 100),
        item("Prüfbauteil Kappa", 175, 620, 80),
        item("Position 1 1 70", 55, 560, 100),
        item("Prüfmodul Gamma", 175, 560, 105),
        item("4 St", 460, 560, 30),
        item("Position 1 1 80", 55, 500, 100)
      ],
      positionNumber: "1.1.70",
      supplierPositionNumber: null,
      description: "Prüfmodul Gamma"
    });

    expect(region).not.toBeNull();
    expect(region?.y).toBeCloseTo(0.285, 2);
    expect(region?.x).toBeCloseTo(55 / 600, 3);
  });

  it("treats an LV reference and adjacent offer marker as one supplier row", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("(1.1.60)", 55, 620, 52),
        item("Angebotsposition 60", 150, 620, 126),
        item("Prüfbauteil Kappa", 290, 620, 80),
        item("(1.1.70)", 55, 560, 52),
        item("Angebotsposition 70", 150, 560, 126),
        item("Prüfmodul Gamma", 290, 560, 105),
        item("4 Stück", 435, 560, 48),
        item("12,34", 520, 560, 38),
        item("(1.1.80)", 55, 500, 52),
        item("Angebotsposition 80", 150, 500, 126)
      ],
      positionNumber: "1.1.70",
      supplierPositionNumber: "1.1.70",
      description: "Angebotsposition 70 Prüfmodul Gamma"
    });

    expect(region).not.toBeNull();
    expect(region?.x).toBeCloseTo(55 / 600, 3);
    expect(region?.width).toBeGreaterThan(0.8);
    expect(region?.height).toBeLessThan(0.04);
  });

  it("keeps every description line until the next measured LV position", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("1.1.70", 55, 650, 45),
        item("Prüfmodul Gamma", 150, 650, 105),
        item("Merkmal Stufe C", 150, 610, 70),
        item("Prüfdruck 2,5 bar", 150, 570, 95),
        item("Fabrikat FiktivWerk", 150, 530, 115),
        item("Art.-Nr. TEST-A-16012", 150, 490, 140),
        item("Vollständig bereitstellen", 150, 450, 185),
        item("1.1.80", 55, 350, 45),
        item("Prüfadapter Sigma", 150, 350, 150)
      ],
      positionNumber: "1.1.70",
      description: "Prüfmodul Gamma Merkmal Stufe C Fabrikat FiktivWerk"
    });

    expect(region).not.toBeNull();
    expect(region?.height).toBeGreaterThan(0.25);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.46);
  });

  it("keeps a long final basis position through quantity while excluding page furniture", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 595,
      pageHeight: 842,
      items: [
        item("1.1.150.", 71, 650, 36, 10),
        item("Prüfadapter Sigma", 142, 639, 111, 10),
        item("4,000 St", 342, 491, 39, 10),
        item("1.1.160.", 71, 465, 36, 10),
        item("Prüfeinheit Delta", 142, 454, 91, 10),
        item("Prüfeinheit Baugröße 40", 142, 431, 102, 10),
        item("Prüfeinheit DEMO 40-10 #1", 142, 419, 164, 10),
        item("mit Testantrieb DemoMotor Serie 40-100F", 142, 408, 229, 10),
        item("Mit Prüfhähnen, Messgerät und Rücklaufsperre im", 142, 397, 262, 10),
        item("Testkreis.", 142, 385, 42, 10),
        item("Die komplette Prüfbaugruppe ist mit Testmaterial", 142, 374, 265, 10),
        item("ummantelt.", 142, 362, 72, 10),
        item("Max. Prüfvolumen bei", 142, 351, 104, 10),
        item("210 mbar: 11,5 m3/h", 142, 340, 110, 10),
        item("260 mbar: 11,0 m3/h", 142, 305, 92, 10),
        item("Delta t = 16K: 210 kW", 142, 283, 97, 10),
        item("Delta t = 8K: 111 kW", 142, 260, 92, 10),
        item("Prüfanschluss: Rp 2 IG", 142, 237, 114, 10),
        item("Abmessungen: HxBxT 700 x 400 x 420 mm", 142, 214, 193, 10),
        item("Fabrikat: FiktivWerk", 142, 191, 105, 10),
        item("Typ: DEMO 40-10 #1", 142, 180, 120, 10),
        item("Art.-Nr.: TEST-A-07922", 142, 169, 125, 10),
        item("Vollständig bereitstellen.", 142, 146, 138, 10),
        item("Alle fiktiven Prüf- und Hilfsmaterialien sind in die", 142, 134, 269, 10),
        item("Testwerte mit einzubeziehen", 142, 123, 153, 10),
        item("4,000 St", 342, 100, 39, 10),
        item("Druckdatum: 17.04.2042", 72, 34, 90, 8),
        item("Seite: 15 von 88", 492, 34, 58, 8),
        item("Beispielplanung GmbH", 69, 805, 126, 12),
        item("Fiktives Planungsbüro für Testanlagen", 198, 805, 243, 11),
        item("Testweg 7, 00000 Musterstadt", 69, 792, 180, 11)
      ],
      positionNumber: "1.1.160",
      supplierPositionNumber: null,
      description:
        "Prüfeinheit DEMO 40-10 Testantrieb Fabrikat FiktivWerk Art.-Nr. TEST-A-07922 vollständig bereitstellen"
    });

    expect(region).not.toBeNull();
    expect(region?.y).toBeCloseTo((842 - 475) / 842, 3);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.87);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.9);
  });

  it("keeps a long final supplier position and excludes its footer", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("Angebotsposition 70", 70, 700, 126, 10),
        item("Kurze Vorposition", 215, 700, 110, 10),
        item("Angebotsposition 80", 70, 600, 126, 10),
        item("Prüfeinheit vollständig", 215, 600, 140, 10),
        item("Technische Beschreibung Zeile 1", 215, 560, 180, 10),
        item("Technische Beschreibung Zeile 2", 215, 520, 180, 10),
        item("Technische Beschreibung Zeile 3", 215, 480, 180, 10),
        item("Fabrikat FiktivWerk", 215, 400, 115, 10),
        item("Art.-Nr. TEST-A-07922", 215, 360, 140, 10),
        item("Vollständig bereitstellen", 215, 300, 185, 10),
        item("Testrabatt -12,34 %", 215, 240, 150, 10),
        item("Prüfsumme 111,22", 215, 200, 140, 10),
        item("Druckdatum: 17.04.2042", 70, 40, 120, 8),
        item("Seite: 9 von 24", 480, 40, 80, 8),
        item("Testangebot FiktivWerk", 70, 770, 130, 10)
      ],
      positionNumber: "1.1.80",
      supplierPositionNumber: "80",
      description: "Prüfeinheit vollständig technische Beschreibung Fabrikat FiktivWerk"
    });

    expect(region).not.toBeNull();
    expect(region?.y).toBeCloseTo((800 - 610) / 800, 3);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.749);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.9);
  });

  it("separates a long final supplier position from an unlabeled lower furniture cluster", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("180", 61, 160, 17, 10),
        item("zu LV-Pos.: 1.1.130.", 102, 160, 94, 10),
        item("TEST-A-05967", 102, 145, 61, 10),
        item("4 ST", 340, 145, 24, 10),
        item("123,45", 412, 145, 31, 10),
        item("493,80", 534, 145, 39, 10),
        item("Prüfsammler Größe B mit Testdichtung", 102, 130, 190, 10),
        item("zum Einbau in fiktive Prüfeinheit DEMO", 102, 118, 210, 10),
        item("X-10 #1, Y-18 #1, A-demo, B-demo, C-demo,", 102, 106, 221, 10),
        item("Prüfsammler-Kombination DEMO Serie 1200-", 102, 94, 232, 10),
        item("x #1", 102, 82, 22, 10),
        item("Anschrift Testweg 7, 00000 Musterstadt", 35, 50, 190, 8),
        item("Bank Beispielinstitut", 250, 50, 95, 8),
        item("Testkonto DEMO-0000-0000", 35, 38, 185, 8),
        item("Testcode DEMODEFFXXX", 250, 38, 90, 8),
        item("Leitung Erika Beispiel", 35, 26, 130, 8)
      ],
      positionNumber: "1.1.130",
      supplierPositionNumber: "1.1.130",
      description: "Prüfsammler zum Einbau in fiktive Prüfeinheit DEMO Serie 1200-x"
    });

    expect(region).not.toBeNull();
    expect(region?.y).toBeCloseTo((800 - 170) / 800, 3);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.897);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.92);
  });

  it.each([
    {
      label: "basis",
      marker: "1.1.160.",
      positionNumber: "1.1.160",
      supplierPositionNumber: null
    },
    {
      label: "supplier",
      marker: "Angebotsposition 80",
      positionNumber: "1.1.80",
      supplierPositionNumber: "80"
    }
  ])(
    "keeps a final multi-item quantity row before an unlabeled footer in a $label PDF",
    ({ marker, positionNumber, supplierPositionNumber }) => {
      const region = locatePdfSourceRegion({
        pageWidth: 600,
        pageHeight: 800,
        items: [
          item(marker, 70, 400, 126, 10),
          item("Lange technische Beschreibung", 142, 380, 180, 10),
          item("Fabrikat FiktivWerk", 142, 160, 115, 10),
          item("Vollständig bereitstellen", 142, 110, 185, 10),
          item("4,000 St", 342, 65, 39, 10),
          item(".........................", 402, 65, 69, 10),
          item(".........................", 484, 65, 69, 10),
          item("Anschrift Testweg 7", 40, 32, 125, 8),
          item("Bank Beispielinstitut", 250, 32, 95, 8),
          item("Testkonto DEMO-0000", 40, 20, 155, 8),
          item("Testcode DEMODEFFXXX", 250, 20, 90, 8)
        ],
        positionNumber,
        supplierPositionNumber,
        description: "Lange technische Beschreibung Fabrikat FiktivWerk vollständig bereitstellen"
      });

      expect(region).not.toBeNull();
      expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.918);
      expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.95);
    }
  );

  it.each(["Seite 9", "Page 9"])(
    "treats a standalone '%s' line as structural footer before lower noise",
    (footerLabel) => {
      const region = locatePdfSourceRegion({
        pageWidth: 600,
        pageHeight: 800,
        items: [
          item("Angebotsposition 80", 70, 500, 126, 10),
          item("Prüfeinheit vollständig", 215, 500, 140, 10),
          item("Technische Beschreibung", 215, 440, 160, 10),
          item("Art.-Nr. TEST-A-07922", 215, 380, 140, 10),
          item("Vollständig bereitstellen", 215, 300, 185, 10),
          item(footerLabel, 480, 60, 60, 8),
          item("Vertrauliche Seitennotiz", 40, 40, 150, 8),
          item("Dokumentkennung 12345", 250, 28, 140, 8)
        ],
        positionNumber: "1.1.80",
        supplierPositionNumber: "80",
        description: "Prüfeinheit vollständig technische Beschreibung"
      });

      expect(region).not.toBeNull();
      expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.62);
      expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.9);
    }
  );

  it("includes the row number of a labeled position and excludes the next row number", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("160", 40, 600, 20, 10),
        item("zu LV-Pos.: 1.1.110.", 100, 600, 110, 10),
        item("TEST-A-28692", 100, 585, 70, 10),
        item("4 ST", 340, 585, 28, 10),
        item("12,50", 420, 585, 30, 10),
        item("50,00", 530, 585, 36, 10),
        item("Prüfgruppe DEMO safe 100-3 #1", 100, 565, 190, 10),
        item("mit Testanzeige und automatischer Prüfeinheit.", 100, 550, 250, 10),
        item("Testrabatt", 100, 510, 70, 10),
        item("-12,34 %", 410, 510, 48, 10),
        item("Prüfsumme", 100, 490, 70, 10),
        item("43,83", 530, 490, 36, 10),
        item("170", 40, 450, 20, 10),
        item("zu LV-Pos.: 1.1.120.", 100, 450, 110, 10),
        item("TEST-A-05802", 100, 435, 70, 10),
        item("8 ST", 335, 435, 34, 10)
      ],
      positionNumber: "1.1.110",
      supplierPositionNumber: "1.1.110",
      description: "Prüfgruppe DEMO safe 100-3 mit Testanzeige"
    });

    expect(region).not.toBeNull();
    expect(region?.x).toBeCloseTo(40 / 600, 3);
    expect(region?.y).toBeCloseTo((800 - 610) / 800, 3);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.387);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.425);
  });

  it("includes a small row number whose baseline is slightly above its labeled position", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("160", 40, 608, 20, 5),
        item("zu LV-Pos.: 1.1.110.", 100, 600, 110, 10),
        item("Prüfgruppe", 100, 570, 100, 10),
        item("170", 40, 458, 20, 5),
        item("zu LV-Pos.: 1.1.120.", 100, 450, 110, 10)
      ],
      positionNumber: "1.1.110",
      supplierPositionNumber: "1.1.110",
      description: "Prüfgruppe"
    });

    expect(region).not.toBeNull();
    expect(region?.x).toBeCloseTo(40 / 600, 3);
    expect(region?.y).toBeCloseTo((800 - 613) / 800, 3);
  });

  it("keeps a long labeled position through its totals without including the next position", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("170", 40, 600, 20, 10),
        item("zu LV-Pos.: 1.1.120.", 100, 600, 110, 10),
        item("TEST-A-05802", 100, 585, 70, 10),
        item("8 ST", 335, 585, 34, 10),
        item("123,00", 410, 585, 36, 10),
        item("984,00", 525, 585, 42, 10),
        item("Fiktive Prüfeinheit DEMO comp X-10 #1", 100, 565, 220, 10),
        item("bis ca. 11,2 Einheiten Testvolumen", 100, 550, 180, 10),
        item("inkl. Testisolierung, Halter und Prüfhülse", 100, 535, 245, 10),
        item("Mit Einbaumöglichkeit für Prüfsammler.", 100, 520, 220, 10),
        item("Prüfanschlüsse: primär R 2 AG", 100, 505, 145, 10),
        item("Abmessungen: HxBxT 700 x 250 x 250 mm", 100, 490, 215, 10),
        item("Testrabatt", 100, 450, 70, 10),
        item("-12,34 %", 410, 450, 48, 10),
        item("Prüfsumme", 100, 430, 70, 10),
        item("862,57", 525, 430, 42, 10),
        item("180", 40, 390, 20, 10),
        item("zu LV-Pos.: 1.1.130.", 100, 390, 110, 10),
        item("TEST-A-05967", 100, 375, 70, 10),
        item("4 ST", 340, 375, 28, 10)
      ],
      positionNumber: "1.1.120",
      supplierPositionNumber: "1.1.120",
      description: "Fiktive Prüfeinheit DEMO comp X-10 mit Testisolierung und Prüfsammler"
    });

    expect(region).not.toBeNull();
    expect(region?.x).toBeCloseTo(40 / 600, 3);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.46);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.5);
  });

  it("does not treat dates or dotted numeric identifiers inside a position as boundaries", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("(1.1.70)", 55, 650, 52, 10),
        item("Prüfmodul Gamma", 150, 650, 105, 10),
        item("Ausgabestand 28.02.2042", 150, 625, 132, 10),
        item("Interne Referenz 123.456.789", 150, 600, 170, 10),
        item("Vollständig bereitstellen", 150, 575, 185, 10),
        item("Testrabatt", 150, 550, 75, 10),
        item("Prüfsumme", 150, 525, 75, 10),
        item("1.1.80", 55, 475, 45, 10),
        item("Prüfadapter Sigma", 150, 475, 150, 10)
      ],
      positionNumber: "1.1.70",
      supplierPositionNumber: "1.1.70",
      description: "Prüfmodul Gamma vollständig bereitstellen"
    });

    expect(region).not.toBeNull();
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.34);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.393);
  });

  it("does not treat standalone or parenthesized dates as position boundaries", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("(1.1.70)", 55, 650, 52, 10),
        item("Prüfmodul Gamma", 150, 650, 105, 10),
        item("12.11.42", 150, 625, 55, 10),
        item("28.02.2042", 150, 600, 66, 10),
        item("(12.11.2042)", 150, 575, 76, 10),
        item("Vollständig bereitstellen", 150, 550, 185, 10),
        item("Prüfsumme", 150, 525, 75, 10),
        item("1.1.80", 55, 475, 45, 10),
        item("Prüfadapter Sigma", 150, 475, 150, 10)
      ],
      positionNumber: "1.1.70",
      supplierPositionNumber: "1.1.70",
      description: "Prüfmodul Gamma vollständig bereitstellen"
    });

    expect(region).not.toBeNull();
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.34);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.393);
  });

  it("does not treat late two-digit years as LV position boundaries", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("(1.1.70)", 55, 650, 52, 10),
        item("Prüfmodul Gamma", 150, 650, 105, 10),
        item("27.11.98", 150, 625, 55, 10),
        item("(27.11.98)", 150, 600, 65, 10),
        item("Vollständig bereitstellen", 150, 550, 185, 10),
        item("Prüfsumme", 150, 525, 75, 10),
        item("1.1.80", 55, 475, 45, 10),
        item("Prüfadapter Sigma", 150, 475, 150, 10)
      ],
      positionNumber: "1.1.70",
      supplierPositionNumber: "1.1.70",
      description: "Prüfmodul Gamma vollständig bereitstellen"
    });

    expect(region).not.toBeNull();
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.34);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.393);
  });

  it("recognizes a three-digit leading LV segment at the start of a text item", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("094.91.3", 55, 650, 52, 10),
        item("Sonderposition Prüfventil", 150, 650, 150, 10),
        item("Vollständig bereitstellen", 150, 625, 185, 10),
        item("Prüfsumme", 150, 600, 75, 10),
        item("(094.91.4)", 55, 550, 62, 10),
        item("Nächste Sonderposition", 150, 550, 140, 10)
      ],
      positionNumber: "094.91.3",
      supplierPositionNumber: null,
      description: "Sonderposition Prüfventil vollständig bereitstellen"
    });

    expect(region).not.toBeNull();
    expect(region?.x).toBeCloseTo(55 / 600, 3);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.249);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.3);
  });

  it("reassembles a position number split across text-layer tokens", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("Position", 55, 650, 45, 10),
        item("1.", 105, 650, 10, 10),
        item("1.", 120, 650, 10, 10),
        item("160", 135, 650, 18, 10),
        item("Prüfeinheit Delta", 180, 650, 82, 10),
        item("Technische Beschreibung", 180, 620, 135, 10),
        item("Position 1.1.170", 55, 550, 100, 10),
        item("Nächste Position", 180, 550, 95, 10)
      ],
      positionNumber: "1.1.160",
      description: "Prüfeinheit Delta Technische Beschreibung"
    });

    expect(region).not.toBeNull();
    expect(region?.x).toBeCloseTo(55 / 600, 3);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.22);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.3);
  });

  it("uses visual order when the PDF content stream is shuffled", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("1.1.70", 55, 650, 45, 10),
        item("1.1.80", 55, 500, 45, 10),
        item("Prüfmodul Gamma", 150, 630, 105, 10),
        item("Merkmal Stufe C", 150, 590, 70, 10),
        item("Prüfdruck 2,5 bar", 150, 550, 95, 10),
        item("Prüfadapter Sigma", 150, 480, 150, 10)
      ],
      positionNumber: "1.1.70",
      description: "Prüfmodul Gamma Merkmal Prüfdruck"
    });

    expect(region).not.toBeNull();
    expect(region?.height).toBeGreaterThan(0.12);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.38);
  });

  it("keeps a position inside its visual column", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("1.1.10", 40, 650, 45, 10),
        item("2.1.10", 320, 650, 45, 10),
        item("Linke Prüfeinheit", 90, 620, 130, 10),
        item("Rechte Prüfgruppe", 370, 620, 145, 10),
        item("Weitere linke Beschreibung", 90, 590, 155, 10),
        item("Weitere rechte Beschreibung", 370, 590, 165, 10),
        item("1.1.20", 40, 520, 45, 10),
        item("2.1.20", 320, 520, 45, 10)
      ],
      positionNumber: "1.1.10",
      description: "Linke Prüfeinheit Weitere linke Beschreibung"
    });

    expect(region).not.toBeNull();
    expect(region?.x).toBeCloseTo(40 / 600, 3);
    expect((region?.x ?? 0) + (region?.width ?? 0)).toBeLessThan(0.5);
    expect(region?.height).toBeGreaterThan(0.07);
  });

  it("uses all description words to disambiguate a repeated position number", () => {
    const shared =
      "Modul Prüfung Anlage Aufbau Ausgabe Steuerung Ventil Anschluss Leistung Material Gerät System";
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("1.1.70", 55, 700, 45, 10),
        item(shared, 150, 680, 370, 10),
        item("1.1.70", 55, 500, 45, 10),
        item(shared, 150, 480, 370, 10),
        item("Zielprodukt Prüfsammler", 150, 450, 170, 10),
        item("1.1.80", 55, 380, 45, 10)
      ],
      positionNumber: "1.1.70",
      description: `${shared} Zielprodukt Prüfsammler`
    });

    expect(region).not.toBeNull();
    expect(region?.y).toBeGreaterThan(0.35);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.54);
  });

  it("fails closed when repeated position candidates remain indistinguishable", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("1.1.70", 55, 700, 45, 10),
        item("Identische Beschreibung", 150, 680, 140, 10),
        item("1.1.70", 55, 500, 45, 10),
        item("Identische Beschreibung", 150, 480, 140, 10),
        item("1.1.80", 55, 400, 45, 10)
      ],
      positionNumber: "1.1.70",
      description: "Identische Beschreibung"
    });

    expect(region).toBeNull();
  });

  it("does not use a dotted article number as the next position boundary", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("1.1.70", 55, 650, 45, 10),
        item("Prüfmodul Gamma", 150, 630, 105, 10),
        item("123.45.6", 150, 600, 60, 10),
        item("Vollständig bereitstellen", 150, 560, 185, 10),
        item("Prüfsumme", 150, 530, 75, 10),
        item("1.1.80", 55, 470, 45, 10)
      ],
      positionNumber: "1.1.70",
      description: "Prüfmodul Gamma vollständig bereitstellen"
    });

    expect(region).not.toBeNull();
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.33);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.43);
  });

  it("recognizes an exact date-like LV number without treating it as a date", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("10.10.25", 55, 650, 55, 10),
        item("Sonderposition Prüfventil", 150, 650, 150, 10),
        item("Vollständig bereitstellen", 150, 610, 185, 10),
        item("10.10.26", 55, 530, 55, 10),
        item("Nächste Sonderposition", 150, 530, 140, 10)
      ],
      positionNumber: "10.10.25",
      description: "Sonderposition Prüfventil vollständig bereitstellen"
    });

    expect(region).not.toBeNull();
    expect(region?.x).toBeCloseTo(55 / 600, 3);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.35);
  });

  it("excludes an explicit footer below the final position even above the last page decile", () => {
    const region = locatePdfSourceRegion({
      pageWidth: 600,
      pageHeight: 800,
      items: [
        item("1.1.160", 55, 500, 50, 10),
        item("Prüfeinheit vollständig", 150, 480, 140, 10),
        item("Technische Beschreibung", 150, 440, 160, 10),
        item("4,000 St", 340, 350, 45, 10),
        item("Druckdatum: 17.04.2042", 55, 245, 120, 10),
        item("Seite 15 von 88", 470, 245, 75, 10),
        item("Fiktive Unternehmensanschrift", 55, 215, 130, 10)
      ],
      positionNumber: "1.1.160",
      description: "Prüfeinheit vollständig Technische Beschreibung"
    });

    expect(region).not.toBeNull();
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeGreaterThan(0.55);
    expect((region?.y ?? 0) + (region?.height ?? 0)).toBeLessThan(0.68);
  });

  it("fails closed when the PDF page has no usable text geometry", () => {
    expect(
      locatePdfSourceRegion({
        pageWidth: 600,
        pageHeight: 800,
        items: [],
        positionNumber: "1.1.160",
        description: "Prüfeinheit"
      })
    ).toBeNull();
  });

  it("adds quiet outward clearance and clamps the frame to the page", () => {
    expect(padPdfSourceRegion({ x: 0.002, y: 0.003, width: 0.5, height: 0.02 })).toMatchObject({
      x: 0,
      y: 0,
      width: 0.506
    });
    expect(
      padPdfSourceRegion({ x: 0.002, y: 0.003, width: 0.5, height: 0.02 })?.height
    ).toBeCloseTo(0.029, 6);
    expect(padPdfSourceRegion({ x: 0, y: 0, width: 0, height: 0 })).toBeNull();
  });
});
