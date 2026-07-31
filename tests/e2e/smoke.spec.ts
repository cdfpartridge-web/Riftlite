import { expect, test } from "@playwright/test";

test("homepage loads and links into the community", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /play the match\. keep the lesson\./i })).toBeVisible();
  await page.getByRole("navigation", { name: /primary navigation/i }).getByRole("link", { name: "Meta" }).click();
  await expect(page).toHaveURL(/community\/meta/);
  await expect(page.getByRole("heading", { name: /which legends are actually winning/i })).toBeVisible();
});

test("community matrix and news pages render", async ({ page }) => {
  await page.goto("/community/matrix");
  await expect(page.getByRole("heading", { name: /find the matchups that swing your win rate/i })).toBeVisible();
  await page.goto("/news");
  await expect(page.getByRole("heading", { name: /patch notes, meta shifts, and announcements/i })).toBeVisible();
});
