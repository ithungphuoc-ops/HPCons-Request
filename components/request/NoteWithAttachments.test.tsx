import { describe, expect, it } from "vitest";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import NoteWithAttachments, { noteAttachmentPlaceholder } from "@/components/request/NoteWithAttachments";
import { MAX_DIRECT_UPLOAD_FILE_SIZE } from "@/lib/constants";
import { DECISION_ATTACHMENT_MAX_FILES } from "@/lib/decision-attachment";
import type { DecisionNoteMode } from "@/lib/decision-note";

function file(name: string, size = 1024): File {
  const f = new File(["x"], name);
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function Harness(props: {
  noteMode: DecisionNoteMode;
  fileMode: DecisionNoteMode;
  atLeastOne?: boolean;
  filesInvalid?: boolean;
  initialFiles?: File[];
}) {
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<File[]>(props.initialFiles ?? []);
  return (
    <NoteWithAttachments
      noteMode={props.noteMode}
      fileMode={props.fileMode}
      noteLabel="Nội dung điều chỉnh"
      noteShortLabel="Nội dung"
      atLeastOne={props.atLeastOne}
      note={note}
      onNoteChange={setNote}
      files={files}
      onFilesChange={setFiles}
      filesInvalid={props.filesInvalid}
      placeholder="Nhập lý do..."
    />
  );
}

const labelText = () => screen.getByTestId("note-with-attachments-label").textContent?.replace(/\s+/g, " ").trim();

describe("NoteWithAttachments — nhãn gộp", () => {
  it("cả 2 không bắt buộc + luật ít nhất 1 → 'hoặc tệp (ít nhất 1 trong 2)'", () => {
    render(<Harness noteMode="optional" fileMode="optional" atLeastOne />);
    expect(labelText()).toBe("Nội dung hoặc tệp (ít nhất 1 trong 2)");
  });

  it("nội dung không bắt buộc + tệp bắt buộc", () => {
    render(<Harness noteMode="optional" fileMode="required" atLeastOne />);
    expect(labelText()).toBe("Nội dung (không bắt buộc) · Tệp *");
  });

  it("nội dung bắt buộc + tệp không bắt buộc", () => {
    render(<Harness noteMode="required" fileMode="optional" />);
    expect(labelText()).toBe("Nội dung * · Tệp (không bắt buộc)");
  });

  it("không có luật ít nhất 1 → '(đều không bắt buộc)'", () => {
    render(<Harness noteMode="optional" fileMode="optional" />);
    expect(labelText()).toBe("Nội dung · Tệp (đều không bắt buộc)");
  });

  it("tắt tệp → không có nút ghim, placeholder giữ nguyên", () => {
    render(<Harness noteMode="required" fileMode="hidden" />);
    expect(screen.queryByLabelText("Đính kèm tệp")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveAttribute("placeholder", "Nhập lý do...");
    expect(labelText()).toBe("Nội dung điều chỉnh *");
  });

  it("tắt nội dung → chỉ còn nút 'Đính kèm tệp' nhỏ", () => {
    render(<Harness noteMode="hidden" fileMode="required" />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Đính kèm tệp" })).toHaveTextContent("Đính kèm tệp");
    expect(labelText()).toBe("Tệp đính kèm *");
  });

  it("tắt cả 2 → không render", () => {
    const { container } = render(<Harness noteMode="hidden" fileMode="hidden" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("NoteWithAttachments — chọn tệp", () => {
  it("chọn nhiều tệp → thẻ + số đếm trên nút ghim, bấm ✕ bỏ được", () => {
    render(<Harness noteMode="optional" fileMode="optional" />);
    const input = screen.getByTestId("decision-attachment-input") as HTMLInputElement;
    expect(input).toHaveAttribute("multiple");
    fireEvent.change(input, { target: { files: [file("a.pdf"), file("b.xlsx")] } });
    expect(screen.getAllByTestId("decision-attachment-chip")).toHaveLength(2);
    expect(screen.getByTestId("decision-attachment-count")).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "Bỏ tệp a.pdf" }));
    expect(screen.getAllByTestId("decision-attachment-chip")).toHaveLength(1);
  });

  it("kéo thả tệp vào ô nội dung vẫn nhận", () => {
    render(<Harness noteMode="optional" fileMode="optional" />);
    fireEvent.drop(screen.getByRole("textbox"), { dataTransfer: { files: [file("c.png")], types: ["Files"] } });
    expect(screen.getAllByTestId("decision-attachment-chip")).toHaveLength(1);
  });

  it("kéo CHỮ (không phải tệp) thả vào ô thì không thêm tệp, không chặn", () => {
    render(<Harness noteMode="optional" fileMode="optional" />);
    const box = screen.getByRole("textbox");
    const ev = createEvent.drop(box, { dataTransfer: { files: [file("d.png")], types: ["text/plain"] } });
    fireEvent(box, ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryAllByTestId("decision-attachment-chip")).toHaveLength(0);
  });

  it("giữ giới hạn dung lượng + số tệp như cũ", () => {
    render(<Harness noteMode="optional" fileMode="optional" />);
    const input = screen.getByTestId("decision-attachment-input");
    fireEvent.change(input, { target: { files: [file("to.zip", MAX_DIRECT_UPLOAD_FILE_SIZE + 1)] } });
    expect(screen.getByText(/vượt quá/)).toBeInTheDocument();
    const many = Array.from({ length: DECISION_ATTACHMENT_MAX_FILES + 1 }, (_, i) => file(`f${i}.pdf`));
    fireEvent.change(input, { target: { files: many } });
    expect(screen.getByText(`Chỉ được đính kèm tối đa ${DECISION_ATTACHMENT_MAX_FILES} tệp mỗi lần.`)).toBeInTheDocument();
    expect(screen.queryAllByTestId("decision-attachment-chip")).toHaveLength(0);
  });

  it("thiếu tệp bắt buộc sau khi gửi → nút ghim viền đỏ", () => {
    render(<Harness noteMode="optional" fileMode="required" filesInvalid />);
    expect(screen.getByRole("button", { name: "Đính kèm tệp" }).className).toContain("color-danger-red");
  });
});

describe("noteAttachmentPlaceholder", () => {
  it("chỉ thêm gợi ý ghim khi tệp bật, bỏ dấu ... cuối", () => {
    expect(noteAttachmentPlaceholder("Nhập lý do...", true)).toBe(
      "Nhập lý do (bấm biểu tượng ghim hoặc kéo thả để đính kèm tệp)",
    );
    expect(noteAttachmentPlaceholder("", true)).toBe("Bấm biểu tượng ghim hoặc kéo thả để đính kèm tệp");
    expect(noteAttachmentPlaceholder("Nhập lý do...", false)).toBe("Nhập lý do...");
  });
});
