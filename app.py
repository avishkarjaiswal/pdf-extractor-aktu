import os
import re
from io import BytesIO
from typing import List, Optional, Tuple, Union, IO, Dict, Any

from flask import Flask, render_template, request, jsonify
from werkzeug.utils import secure_filename
import pdfplumber


def create_app() -> Flask:
    app = Flask(__name__)

    # Configuration
    app.config["UPLOAD_FOLDER"] = os.path.join(app.root_path, "uploads")
    app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024  # 25 MB limit for safety

    # Ensure uploads directory exists
    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

    allowed_extensions = {"pdf"}

    def is_allowed_file(filename: str) -> bool:
        return "." in filename and filename.rsplit(".", 1)[1].lower() in allowed_extensions

    def extract_marksheet_blocks(pdf_source: Union[str, IO[bytes]]) -> Tuple[List[Tuple[str, str]], List[Dict[str, Any]]]:
        """
        Extract the marksheet table section between the header line and a stop marker.

        Header is matched by regex `header_regex`. Stop markers are lines containing
        "Total" or "SGPA" (case-insensitive). Lines are split into columns by two or
        more spaces.

        To adjust for a different table header, edit `header_regex` below. You can also
        update `stop_markers` or switch to more specific end conditions.
        """
        # Edit this regex to match a different header for other PDFs
        header_regex = re.compile(
            r"^\s*Code\s+Name\s+Type\s+Internal\s+External\s+Back\s+Paper\s+Grade\s*$",
            re.IGNORECASE,
        )

        # Edit/extend these stop markers if your table ends differently
        stop_markers = ["total", "sgpa"]

        all_lines: List[str] = []
        with pdfplumber.open(pdf_source) as pdf:
            for page in pdf.pages:
                text = page.extract_text() or ""
                # Normalize internal whitespace slightly to improve splitting
                all_lines.extend(text.splitlines())
        full_text = "\n".join(all_lines)

        # Find header start
        start_index: Optional[int] = None
        for idx, raw in enumerate(all_lines):
            if header_regex.search(raw.strip()):
                start_index = idx
                break

        # Extract general info across entire text by matching known labels
        target_fields_order = [
            "Institute Code & Name",
            "Course Code & Name",
            "Branch Code & Name",
            "RollNo",
            "EnrollmentNo",
            "Name",
            "Hindi Name",
            "Father's Name",
            "Gender",
            "Session",
            "Semester",
            "Even/Odd",
            "SGPA",
            "Total Marks Obt.",
            "Result Status",
        ]
        normalized_targets = [(key, key.lower()) for key in target_fields_order]
        found_map = {}
        for raw in all_lines:
            line = raw.strip()
            if not line or ":" not in line:
                continue
            left, right = line.split(":", 1)
            key = left.strip()
            value = right.strip()
            lkey = key.lower()
            for original, norm in normalized_targets:
                if lkey.startswith(norm) and original not in found_map:
                    found_map[original] = value
                    break

        # Regex fallback extraction for fields not caught by simple split
        patterns = {
            "Institute Code & Name": re.compile(r"Institute\s*Code\s*&\s*Name\s*:\s*(.+)", re.IGNORECASE),
            "Course Code & Name": re.compile(r"Course\s*Code\s*&\s*Name\s*:\s*(.+)", re.IGNORECASE),
            "Branch Code & Name": re.compile(r"Branch\s*Code\s*&\s*Name\s*:\s*(.+)", re.IGNORECASE),
            "RollNo": re.compile(r"Roll\s*No\s*:\s*(\d+)", re.IGNORECASE),
            "EnrollmentNo": re.compile(r"Enrollment\s*No\s*:\s*(.+)", re.IGNORECASE),
            # Name: stop before 'Hindi Name' if present on same line
            "Name": re.compile(r"Name\s*:\s*(.+?)(?=\s*Hindi\s*Name\s*:|$)", re.IGNORECASE),
            "Hindi Name": re.compile(r"Hindi\s*Name\s*:\s*(.+)", re.IGNORECASE),
            "Gender": re.compile(r"Gender\s*:\s*([A-Za-z]+)", re.IGNORECASE),
            "Session": re.compile(r"Session\s*:\s*(.+)", re.IGNORECASE),
            "Semester": re.compile(r"Semester\s*:\s*(\d+)", re.IGNORECASE),
            "Even/Odd": re.compile(r"Even\s*/\s*Odd\s*:\s*(Even|Odd)", re.IGNORECASE),
            "SGPA": re.compile(r"SGPA\s*:\s*([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE),
            "Total Marks Obt.": re.compile(r"Total\s*Marks\s*Obt\.?\s*:\s*([0-9]+)", re.IGNORECASE),
            "Result Status": re.compile(r"Result\s*Status\s*:\s*(.+)", re.IGNORECASE),
        }

        for label, regex in patterns.items():
            if label in found_map and found_map[label]:
                continue
            m = regex.search(full_text)
            if m:
                found_map[label] = m.group(1).strip()
        # Post-process per custom rules
        roll_val = found_map.get("RollNo", "")
        m_roll = re.match(r"\d+", roll_val)
        if m_roll:
            roll_val = m_roll.group(0)

        enroll_val = found_map.get("EnrollmentNo", "")
        # Keep full EnrollmentNo value (e.g., "PROVISIONAL View.") if present

        name_val = found_map.get("Name", "")
        # If Hindi value leaked into Name line, cut at the word 'Hindi'
        if "Hindi" in name_val:
            name_val = name_val.split("Hindi", 1)[0].strip().rstrip(":")

        marks_val = found_map.get("Total Marks Obt.", "")
        sgpa_val = found_map.get("SGPA", "")

        # Build final ordered list (remove Session and Result Status; show Marks and SGPA instead)
        general_info: List[Tuple[str, str]] = []
        def add(label: str, value: str, always: bool = False):
            if always or value != "":
                general_info.append((label, value))

        add("Institute Code & Name", found_map.get("Institute Code & Name", ""))
        add("Course Code & Name", found_map.get("Course Code & Name", ""))
        add("Branch Code & Name", found_map.get("Branch Code & Name", ""))
        add("RollNo", roll_val)
        add("EnrollmentNo", enroll_val)
        add("Name", name_val)
        add("Hindi Name", found_map.get("Hindi Name", ""))
        # Removed Father's Name per requirement
        add("Gender", found_map.get("Gender", ""))
        add("Semester", found_map.get("Semester", ""))
        add("Even/Odd", found_map.get("Even/Odd", ""))
        # Always include these rows even if empty
        add("Total Marks Obt. :", marks_val, always=True)
        add("SGPA :", sgpa_val, always=True)

        # We will parse the document into marksheet blocks. A block starts when a
        # line beginning with "Semester :" appears, we then collect summary fields
        # until the tabular header appears, then parse table rows until stop.

        header_regex = re.compile(
            r"^\s*Code\s+Name\s+Type\s+Internal\s+External\s+Back\s+Paper\s+Grade\s*$",
            re.IGNORECASE,
        )
        # Stop only at the next heading or page section, not at 'total/sgpa/result' inline text
        heading_result_regex = re.compile(r"^(?:Minor|Major)\s*Result", re.IGNORECASE)

        # Fixed marksheet table header
        header_cols = [
            "Code",
            "Name",
            "Type",
            "Internal",
            "External",
            "Back Paper",
            "Grade",
        ]

        def parse_row_to_columns(raw: str) -> Optional[List[str]]:
            # Flexible parser: allows optional External, Back Paper, Grade and broader Type values
            pattern = re.compile(
                r"^\s*"
                r"([A-Z]{3}\d{3})"                        # Code
                r"\s+"
                r"(.+?)"                                    # Subject name
                r"\s+"
                r"(Theory|Practical|CA|Lab|Project|Workshop|Training)"  # Type
                r"\s+"
                r"(\d+)"                                   # Internal
                r"(?:\s+(\d+|--))?"                       # External (optional)
                r"(?:\s+(--|\d+))?"                       # Back Paper (optional)
                r"(?:\s+([A-Za-z]{1,2}\+?))?"             # Grade (optional)
                r"\s*$",
                re.IGNORECASE,
            )
            txt = re.sub(r"\s+", " ", raw.strip())
            m = pattern.match(txt)
            if not m:
                return None
            code, name, course_type, internal, external, back_paper, grade = m.groups()
            # Fill missing optional fields with "--"
            external = external or "--"
            back_paper = back_paper or "--"
            grade = grade or "--"
            return [code, name.strip(), course_type.capitalize(), internal, external, back_paper, grade]

        # Heuristic: does a line look like the start of a subject row (code at start)?
        code_start_regex = re.compile(r"^[A-Z]{3}\d{3}\b", re.IGNORECASE)

        # Summary field regexes
        re_semester = re.compile(r"^\s*Semester\s*:\s*(\d+)", re.IGNORECASE)
        re_even_odd = re.compile(r"Even\s*/\s*Odd\s*:\s*(Even|Odd)", re.IGNORECASE)
        re_total_sub = re.compile(r"Total\s*Subjects\s*:\s*(\d+)", re.IGNORECASE)
        re_theory_sub = re.compile(r"Theory\s*:\s*(\d+)", re.IGNORECASE)
        re_practical_sub = re.compile(r"Practical\s*:\s*(\d+)", re.IGNORECASE)
        re_total_marks = re.compile(r"Total\s*Marks\s*Obt\.?\s*:\s*([0-9]+)", re.IGNORECASE)
        re_result_status = re.compile(r"Result\s*Status\s*:\s*(.+)", re.IGNORECASE)
        re_sgpa = re.compile(r"SGPA\s*:\s*([0-9]+(?:\.[0-9]+)?)", re.IGNORECASE)
        re_decl_date = re.compile(r"Date\s*of\s*Declaration\s*:\s*([0-9/\-]+)", re.IGNORECASE)

        marksheet_blocks: List[Dict[str, Any]] = []

        def finalize_block(summary: Dict[str, str], table_rows: List[List[str]]):
            if not table_rows:
                return
            # Optionally, verify against Total Subjects count
            expected = summary.get("Total Subjects")
            if expected and expected.isdigit():
                # This doesn't modify rows; it is a soft check. Could be surfaced if needed.
                _ = int(expected)  # placeholder to emphasize read/validation
            marksheet_blocks.append({
                "summary": summary,
                "header": header_cols,
                "rows": table_rows,
            })

        with pdfplumber.open(pdf_source) as pdf:
            for page in pdf.pages:
                lines = (page.extract_text() or "").splitlines()
                i = 0
                current_summary: Optional[Dict[str, str]] = None
                while i < len(lines):
                    line = (lines[i] or "").strip()
                    # Start a new block when 'Semester :' appears
                    m_sem = re_semester.search(line)
                    if m_sem:
                        # Start fresh summary with required fields only
                        current_summary = {
                            "Semester": m_sem.group(1),
                            "Even/Odd": "",
                            "Total Marks Obt.": "",
                            "Result Status": "",
                            "SGPA": "",
                        }
                        i += 1
                        # Collect summary lines until header line
                        while i < len(lines):
                            l2 = (lines[i] or "").strip()
                            if header_regex.search(l2):
                                # parse table rows following header
                                i += 1
                                table_rows: List[List[str]] = []
                                buffer = ""
                                while i < len(lines):
                                    l3 = (lines[i] or "").strip()
                                    # Stop conditions: next marksheet heading or page section
                                    if re_semester.search(l3) or heading_result_regex.search(l3):
                                        break
                                    if header_regex.search(l3):
                                        # header repeated; skip and continue collecting rows
                                        i += 1
                                        continue
                                    if not l3:
                                        # allow line breaks inside wrapped names
                                        i += 1
                                        continue
                                    # Try to parse current line or buffered+current
                                    combined = (buffer + " " + l3).strip() if buffer else l3
                                    parsed = parse_row_to_columns(combined)
                                    if parsed is not None:
                                        table_rows.append(parsed)
                                        buffer = ""
                                        i += 1
                                        continue
                                    # If not parsed, and looks like a new subject code while buffer not empty,
                                    # attempt parsing buffer alone before starting new buffer
                                    if buffer and code_start_regex.search(l3):
                                        parsed_buf = parse_row_to_columns(buffer)
                                        if parsed_buf is not None:
                                            table_rows.append(parsed_buf)
                                            buffer = l3
                                            i += 1
                                            continue
                                    # Otherwise, accumulate into buffer
                                    buffer = (buffer + " " + l3).strip() if buffer else l3
                                    i += 1
                                # flush trailing buffer
                                if buffer:
                                    parsed_buf = parse_row_to_columns(buffer)
                                    if parsed_buf is not None:
                                        table_rows.append(parsed_buf)
                                # finalize block
                                if current_summary is not None:
                                    finalize_block(current_summary, table_rows)
                                    current_summary = None
                                # do not consume stop marker; next loop will handle
                                continue
                            # capture summary fields
                            if current_summary is not None:
                                m = re_even_odd.search(l2)
                                if m:
                                    # Append Even/Odd to Semester display only; do not store separate label fields slated for removal
                                    current_summary["Even/Odd"] = m.group(1)
                                m = re_total_marks.search(l2)
                                if m:
                                    current_summary["Total Marks Obt."] = m.group(1)
                                m = re_result_status.search(l2)
                                if m:
                                    current_summary["Result Status"] = m.group(1).strip()
                                m = re_sgpa.search(l2)
                                if m:
                                    current_summary["SGPA"] = m.group(1)
                            # Advance
                            # Stop collecting summary if next Semester encountered
                            if re_semester.search(l2):
                                break
                            i += 1
                        # do not increment i here; outer loop continues
                        continue

                    i += 1

        return (general_info, marksheet_blocks)

    @app.route("/", methods=["GET", "POST"])
    def index():
        general_info: List[Tuple[str, str]] = []
        marksheet_blocks: List[Dict[str, Any]] = []
        count_value: str = ""

        if request.method == "POST":
            if "pdf" not in request.files:
                return render_template("index.html", extracted_text="", error="No file part in the request.")

            file = request.files["pdf"]
            if file.filename == "":
                return render_template("index.html", extracted_text="", error="No file selected.")

            if file and is_allowed_file(file.filename):
                try:
                    # Read into memory and process without saving to disk
                    file_bytes = file.read()
                    if not file_bytes:
                        return render_template("index.html", general_info=[], marksheet_blocks=[], error="Empty file.", count_value=count_value)
                    general_info, marksheet_blocks = extract_marksheet_blocks(BytesIO(file_bytes))
                    # Always render all extracted rows; ignore any requested count limit
                    count_value = (request.form.get("count") or "").strip()
                except Exception as exc:
                    return render_template(
                        "index.html",
                        general_info=[],
                        marksheet_blocks=[],
                        error=f"Failed to extract text: {exc}",
                        count_value=count_value,
                    )
            else:
                return render_template("index.html", general_info=[], marksheet_blocks=[], error="Only PDF files are allowed.", count_value=count_value)

        return render_template("index.html", general_info=general_info, marksheet_blocks=marksheet_blocks, error=None, count_value=count_value)

    @app.route("/api/list_pdfs", methods=["GET"])
    def api_list_pdfs():
        # In-memory mode: do not list persisted files
        return jsonify({"files": []})

    @app.route("/api/upload_pdfs", methods=["POST"])
    def api_upload_pdfs():
        if "pdfs" not in request.files:
            # Support both 'pdfs' (multiple) and 'pdf' (single)
            if "pdf" not in request.files:
                return jsonify({"error": "No files provided"}), 400
            files = [request.files["pdf"]]
        else:
            files = request.files.getlist("pdfs")

        # In-memory mode: skip saving; acknowledge without persistence
        return jsonify({"saved": []})

    @app.route("/api/extract", methods=["POST"]) 
    def api_extract():
        data = request.get_json(silent=True) or {}
        filename = (data.get("filename") or "").strip()
        if not filename:
            return jsonify({"error": "filename is required"}), 400
        pdf_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        if not os.path.isfile(pdf_path):
            return jsonify({"error": "file not found"}), 404
        try:
            general_info, marksheet_blocks = extract_marksheet_blocks(pdf_path)
            return jsonify({
                "general_info": general_info,
                "marksheet_blocks": marksheet_blocks,
            })
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/extract_stream", methods=["POST"]) 
    def api_extract_stream():
        if "pdf" not in request.files:
            return jsonify({"error": "No file provided"}), 400
        file = request.files["pdf"]
        if not file or file.filename == "":
            return jsonify({"error": "Empty file"}), 400
        if not is_allowed_file(file.filename):
            return jsonify({"error": "Only PDF files are allowed"}), 400
        try:
            data = file.read()
            if not data:
                return jsonify({"error": "Empty file"}), 400
            general_info, marksheet_blocks = extract_marksheet_blocks(BytesIO(data))
            return jsonify({
                "general_info": general_info,
                "marksheet_blocks": marksheet_blocks,
            })
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/delete_pdf", methods=["POST"]) 
    def api_delete_pdf():
        data = request.get_json(silent=True) or {}
        filename = (data.get("filename") or "").strip()
        if not filename:
            return jsonify({"error": "filename is required"}), 400
        pdf_path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
        try:
            if os.path.isfile(pdf_path):
                os.remove(pdf_path)
            return jsonify({"deleted": filename})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/delete_all", methods=["POST"]) 
    def api_delete_all():
        try:
            removed = []
            for f in os.listdir(app.config["UPLOAD_FOLDER"]):
                if is_allowed_file(f):
                    path = os.path.join(app.config["UPLOAD_FOLDER"], f)
                    if os.path.isfile(path):
                        os.remove(path)
                        removed.append(f)
            return jsonify({"deleted": removed, "count": len(removed)})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    return app


if __name__ == "__main__":
    # Run the app locally with debug enabled as requested
    app = create_app()
    app.run(debug=True)


