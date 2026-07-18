import { createElement } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("next/script", () => ({
  default: ({ src }: { src: string }) => createElement("script", { "data-testid": "third-party-script", src }),
}));

vi.mock("@/components/analytics/page-view-tracker", () => ({
  PageViewTracker: () => createElement("div", { "data-testid": "page-view-tracker" }),
}));

import { SiteThirdPartyScripts } from "@/components/analytics/site-third-party-scripts";

describe("site third-party scripts", () => {
  beforeEach(() => {
    mocks.pathname = "/";
  });

  it("suppresses analytics and advertising on the device-link route", () => {
    mocks.pathname = "/link-device";
    const view = render(createElement(SiteThirdPartyScripts));

    expect(view.queryByTestId("page-view-tracker")).not.toBeInTheDocument();
    expect(view.queryByTestId("third-party-script")).not.toBeInTheDocument();
  });

  it("keeps analytics and advertising on ordinary website routes", () => {
    const view = render(createElement(SiteThirdPartyScripts));

    expect(view.getByTestId("page-view-tracker")).toBeInTheDocument();
    expect(view.getByTestId("third-party-script")).toHaveAttribute(
      "src",
      expect.stringContaining("pagead2.googlesyndication.com"),
    );
  });
});
