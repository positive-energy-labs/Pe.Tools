import importlib.util
import io
import unittest
from pathlib import Path

import pdfplumber
import pikepdf


SPEC = importlib.util.spec_from_file_location("mine_bluebeam", Path(__file__).with_name("mine-bluebeam.py"))
MINE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MINE)


def fixture_pdf():
    pdf = pikepdf.Pdf.new()
    font = pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name.Font,
        Subtype=pikepdf.Name.Type1,
        BaseFont=pikepdf.Name.Helvetica,
    ))
    cases = [(rotation, origin) for origin in ((0, 0), (10, 20)) for rotation in (0, 90, 180, 270)]
    for rotation, (x0, y0) in cases:
        page = pdf.add_blank_page(page_size=(200, 100))
        page.MediaBox = pikepdf.Array([x0, y0, x0 + 200, y0 + 100])
        page.CropBox = page.MediaBox
        page.Rotate = rotation
        page.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
        page.Contents = pdf.make_stream(b"BT /F1 12 Tf 30 40 Td (111) Tj ET")
    output = io.BytesIO()
    pdf.save(output)
    return output.getvalue(), cases


class ExtractWordsTests(unittest.TestCase):
    def test_returns_raw_pdf_coordinates_for_rotated_and_shifted_pages(self):
        data, cases = fixture_pdf()
        legacy_failures = 0
        for page_index, _ in enumerate(cases):
            expected = "111"
            word = next(w for w in MINE.extract_words(io.BytesIO(data), page_index) if w["text"] == expected)
            self.assertTrue(35 < word["x"] < 45 and 40 < word["y"] < 48, (page_index, word))

            with pdfplumber.open(io.BytesIO(data)) as pdf:
                page = pdf.pages[page_index]
                old = next(w for w in page.extract_words() if w["text"] == expected)
                legacy = ((old["x0"] + old["x1"]) / 2,
                          page.height - (old["top"] + old["bottom"]) / 2)
                legacy_failures += not (35 < legacy[0] < 45 and 40 < legacy[1] < 48)

        self.assertEqual(legacy_failures, 6)
        self.assertIsNotNone(MINE.ROOM_NUM.fullmatch("115.2"))


if __name__ == "__main__":
    unittest.main()
