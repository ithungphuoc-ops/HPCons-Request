import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ColumnTypePicker from "./ColumnTypePicker";
import MultiChoiceCellInput from "@/components/request/MultiChoiceCellInput";

describe("ColumnTypePicker — ô chọn kiểu cột có Lọc nhanh (07/10/2026)", () => {
  it("gõ 'ngay' chỉ còn Ngày/Ngày giờ, bấm chọn → onChange + đóng khung", () => {
    const onChange = vi.fn();
    render(<ColumnTypePicker value="text" onChange={onChange} ariaLabel="Kiểu dữ liệu cột 1" />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểu dữ liệu cột 1" }));
    fireEvent.change(screen.getByLabelText("Lọc nhanh kiểu dữ liệu"), { target: { value: "ngay" } });
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Ngày", "Ngày giờ"]);
    fireEvent.click(screen.getByRole("option", { name: "Ngày giờ" }));
    expect(onChange).toHaveBeenCalledWith("datetime");
    expect(screen.queryByLabelText("Lọc nhanh kiểu dữ liệu")).not.toBeInTheDocument();
  });

  it("kiểu đang chọn được đánh dấu aria-selected", () => {
    render(<ColumnTypePicker value="money" onChange={() => {}} ariaLabel="Kiểu" />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểu" }));
    expect(screen.getByRole("option", { name: "Tiền tệ (VNĐ)" })).toHaveAttribute("aria-selected", "true");
  });

  it("Esc đóng khung nhưng KHÔNG lan tới listener Esc của hộp thoại bên dưới", () => {
    const modalEsc = vi.fn();
    window.addEventListener("keydown", modalEsc);
    render(<ColumnTypePicker value="text" onChange={() => {}} ariaLabel="Kiểu" />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểu" }));
    fireEvent.keyDown(screen.getByLabelText("Lọc nhanh kiểu dữ liệu"), { key: "Escape" });
    expect(screen.queryByLabelText("Lọc nhanh kiểu dữ liệu")).not.toBeInTheDocument();
    expect(modalEsc).not.toHaveBeenCalled();
    window.removeEventListener("keydown", modalEsc);
  });

  it("bấm ra ngoài thì đóng", () => {
    render(<ColumnTypePicker value="text" onChange={() => {}} ariaLabel="Kiểu" />);
    fireEvent.click(screen.getByRole("button", { name: "Kiểu" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByLabelText("Lọc nhanh kiểu dữ liệu")).not.toBeInTheDocument();
  });
});

describe("MultiChoiceCellInput — ô nhiều lựa chọn trong bảng", () => {
  it("tick phương án → giá trị nối ', ' theo thứ tự admin khai", () => {
    const onCommit = vi.fn();
    render(
      <MultiChoiceCellInput
        value="NAS"
        options={["Base", "Email công ty", "NAS"]}
        columnName="Phần mềm"
        invalid={false}
        onCommit={onCommit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Phần mềm" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Base" }));
    expect(onCommit).toHaveBeenCalledWith("Base, NAS");
  });
});
