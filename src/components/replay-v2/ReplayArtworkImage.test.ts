import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ReplayArtworkImage } from "./ReplayArtworkImage";

function load(image: HTMLImageElement, width: number, height: number) {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  });
  fireEvent.load(image);
}

describe("battlefield scan orientation", () => {
  it("keeps native landscape art upright and resets when changing to a portrait scan", () => {
    const view = render(createElement(ReplayArtworkImage, { battlefield: true, alt: "Battlefield", src: "/radiance.png" }));
    load(view.getByAltText("Battlefield") as HTMLImageElement, 1039, 744);
    expect(view.getByAltText("Battlefield")).toHaveAttribute("data-battlefield-landscape", "true");

    view.rerender(createElement(ReplayArtworkImage, { battlefield: true, alt: "Battlefield", src: "/origins.webp" }));
    expect(view.getByAltText("Battlefield")).not.toHaveAttribute("data-battlefield-landscape");
    load(view.getByAltText("Battlefield") as HTMLImageElement, 744, 1039);
    expect(view.getByAltText("Battlefield")).not.toHaveAttribute("data-battlefield-landscape");
  });

  it("does not change non-battlefield card orientation", () => {
    const view = render(createElement(ReplayArtworkImage, { alt: "Card", src: "/art.png" }));
    load(view.getByAltText("Card") as HTMLImageElement, 1039, 744);
    expect(view.getByAltText("Card")).not.toHaveAttribute("data-battlefield-landscape");
  });
});
