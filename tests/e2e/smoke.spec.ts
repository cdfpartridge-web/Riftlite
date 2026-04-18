import { expect, test } from "@playwright/test";

test("homepage loads and links into the community", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /community dashboard/i })).toBeVisible();
  await page.getByRole("link", { name: /explore community stats/i }).click();
  await expect(page).toHaveURL(/community\/leaderboard/);
});

test("community matrix and news pages render", async ({ page }) => {
  await page.goto("/community/matrix");
  await expect(page.getByText(/see which public matchups/i)).toBeVisible();
  await page.goto("/news");
  await expect(page.getByRole("heading", { name: /updates, announcements/i })).toBeVisible();
});
