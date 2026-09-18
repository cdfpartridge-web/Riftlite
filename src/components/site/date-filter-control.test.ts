import { createElement, useState } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ALL_DATES, isInDateFilter } from "@/lib/date-filter";
import { DateFilterControl } from "./date-filter-control";

function Example() {
  const [value, setValue] = useState(ALL_DATES);
  const rows = ["2026-09-17", "2026-09-18", "2026-09-19"].filter((day) => isInDateFilter(day, value));
  return createElement("div", null, createElement(DateFilterControl, { value, onChange: setValue }), createElement("output", { "aria-label": "Shown dates" }, rows.join(",")));
}

describe("date filter controls", () => {
  it("selects one day, includes an end day in a range and restores all data", () => {
    const view = render(createElement(Example));
    fireEvent.change(view.getByRole("combobox", { name: "Date" }), { target: { value: "date" } });
    fireEvent.change(view.getByLabelText("Selected date"), { target: { value: "2026-09-18" } });
    expect(view.getByLabelText("Shown dates").textContent).toBe("2026-09-18");
    fireEvent.change(view.getByRole("combobox", { name: "Date" }), { target: { value: "custom" } });
    fireEvent.change(view.getByLabelText("To"), { target: { value: "2026-09-19" } });
    expect(view.getByLabelText("Shown dates").textContent).toBe("2026-09-18,2026-09-19");
    fireEvent.change(view.getByRole("combobox", { name: "Date" }), { target: { value: "all" } });
    expect(view.getByLabelText("Shown dates").textContent).toBe("2026-09-17,2026-09-18,2026-09-19");
  });

  it("shows a clear error and no results for incomplete/reversed ranges", () => {
    const view = render(createElement(Example));
    fireEvent.change(view.getByRole("combobox", { name: "Date" }), { target: { value: "custom" } });
    fireEvent.change(view.getByLabelText("From"), { target: { value: "2026-09-18" } });
    fireEvent.change(view.getByLabelText("To"), { target: { value: "2026-09-17" } });
    expect(view.getByRole("alert")).toHaveTextContent("End date must be on or after start date.");
    expect(view.getByLabelText("Shown dates").textContent).toBe("");
    fireEvent.change(view.getByLabelText("From"), { target: { value: "" } });
    expect(view.getByRole("alert")).toHaveTextContent("Choose a valid date.");
  });
});
