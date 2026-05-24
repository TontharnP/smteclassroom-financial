from html import escape
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, Preformatted, SimpleDocTemplate, Spacer


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "generated" / "classroom-finance-handoff-guide.md"
OUTPUT = ROOT / "docs" / "generated" / "classroom-finance-handoff-guide.pdf"

FONT_REGULAR = "/System/Library/Fonts/Supplemental/Tahoma.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Tahoma Bold.ttf"


def register_fonts():
    pdfmetrics.registerFont(TTFont("ThaiRegular", FONT_REGULAR))
    pdfmetrics.registerFont(TTFont("ThaiBold", FONT_BOLD))


def make_styles():
    base = getSampleStyleSheet()
    base.add(
        ParagraphStyle(
            name="DocTitle",
            parent=base["Title"],
            fontName="ThaiBold",
            fontSize=24,
            leading=31,
            textColor=colors.HexColor("#0F172A"),
            spaceAfter=10,
        )
    )
    base.add(
        ParagraphStyle(
            name="H2Thai",
            parent=base["Heading2"],
            fontName="ThaiBold",
            fontSize=15,
            leading=21,
            textColor=colors.HexColor("#1D4ED8"),
            spaceBefore=10,
            spaceAfter=6,
        )
    )
    base.add(
        ParagraphStyle(
            name="H3Thai",
            parent=base["Heading3"],
            fontName="ThaiBold",
            fontSize=12.5,
            leading=18,
            textColor=colors.HexColor("#0F172A"),
            spaceBefore=7,
            spaceAfter=4,
        )
    )
    base.add(
        ParagraphStyle(
            name="BodyThai",
            parent=base["BodyText"],
            fontName="ThaiRegular",
            fontSize=9.4,
            leading=14,
            textColor=colors.HexColor("#111827"),
            spaceAfter=5,
        )
    )
    base.add(
        ParagraphStyle(
            name="BulletThai",
            parent=base["BodyText"],
            fontName="ThaiRegular",
            fontSize=9.2,
            leading=13.5,
            leftIndent=10,
            firstLineIndent=-8,
            textColor=colors.HexColor("#111827"),
            spaceAfter=3,
        )
    )
    base.add(
        ParagraphStyle(
            name="QuoteThai",
            parent=base["BodyText"],
            fontName="ThaiRegular",
            fontSize=9,
            leading=13.5,
            leftIndent=9,
            borderColor=colors.HexColor("#CBD5E1"),
            borderWidth=0.8,
            borderPadding=5,
            textColor=colors.HexColor("#334155"),
            backColor=colors.HexColor("#F8FAFC"),
            spaceAfter=6,
        )
    )
    base.add(
        ParagraphStyle(
            name="CodeThai",
            parent=base["Code"],
            fontName="ThaiRegular",
            fontSize=8.1,
            leading=10.8,
            textColor=colors.HexColor("#0F172A"),
            backColor=colors.HexColor("#F1F5F9"),
            borderColor=colors.HexColor("#E2E8F0"),
            borderWidth=0.5,
            borderPadding=5,
            spaceBefore=3,
            spaceAfter=7,
        )
    )
    return base


def inline_markup(text):
    text = escape(text)
    parts = text.split("`")
    for index in range(1, len(parts), 2):
        parts[index] = f'<font color="#B45309">{parts[index]}</font>'
    return "".join(parts)


def build_story(markdown, styles):
    story = []
    lines = markdown.splitlines()
    paragraph = []
    in_code = False
    code_lines = []

    def flush_paragraph():
        if paragraph:
            text = " ".join(paragraph).strip()
            story.append(Paragraph(inline_markup(text), styles["BodyThai"]))
            paragraph.clear()

    def flush_code():
        if code_lines:
            story.append(Preformatted("\n".join(code_lines), styles["CodeThai"]))
            code_lines.clear()

    for raw in lines:
        line = raw.rstrip()

        if line.startswith("```"):
            if in_code:
                flush_code()
                in_code = False
            else:
                flush_paragraph()
                in_code = True
            continue

        if in_code:
            code_lines.append(line)
            continue

        stripped = line.strip()
        if not stripped:
            flush_paragraph()
            continue

        if stripped == "---":
            flush_paragraph()
            story.append(Spacer(1, 3 * mm))
            continue

        if stripped.startswith("# "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(stripped[2:]), styles["DocTitle"]))
            story.append(Spacer(1, 3 * mm))
            continue

        if stripped.startswith("## "):
            flush_paragraph()
            if story:
                story.append(Spacer(1, 2 * mm))
            story.append(Paragraph(inline_markup(stripped[3:]), styles["H2Thai"]))
            continue

        if stripped.startswith("### "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(stripped[4:]), styles["H3Thai"]))
            continue

        if stripped.startswith("> "):
            flush_paragraph()
            story.append(Paragraph(inline_markup(stripped[2:]), styles["QuoteThai"]))
            continue

        if stripped.startswith("- "):
            flush_paragraph()
            story.append(Paragraph("- " + inline_markup(stripped[2:]), styles["BulletThai"]))
            continue

        if stripped[:3].endswith(". ") and stripped[0].isdigit():
            flush_paragraph()
            story.append(Paragraph(inline_markup(stripped), styles["BulletThai"]))
            continue

        paragraph.append(stripped)

    flush_paragraph()
    flush_code()
    return story


def draw_footer(canvas, document):
    canvas.saveState()
    width, _ = A4
    canvas.setFont("ThaiRegular", 7.2)
    canvas.setFillColor(colors.HexColor("#64748B"))
    canvas.drawString(14 * mm, 8 * mm, f"Classroom Finance 5 Handoff Guide | Page {document.page}")
    canvas.drawRightString(width - 14 * mm, 8 * mm, "Generated from repository handoff documentation")
    canvas.restoreState()


def build_pdf():
    register_fonts()
    styles = make_styles()
    markdown = SOURCE.read_text(encoding="utf-8")
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=14 * mm,
        leftMargin=14 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title="คู่มือส่งต่อ Classroom Finance 5",
        author="Classroom Finance 5",
    )
    story = build_story(markdown, styles)
    story.append(PageBreak())
    story.append(Paragraph("จบเอกสาร", styles["H2Thai"]))
    story.append(Paragraph("หากต้องแก้ระบบ ให้แก้จาก source code และอัปเดตคู่มือนี้พร้อมกันเสมอ", styles["BodyThai"]))
    doc.build(story, onFirstPage=draw_footer, onLaterPages=draw_footer)


if __name__ == "__main__":
    build_pdf()
    print(OUTPUT)
