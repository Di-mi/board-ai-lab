import { describe, expect, test } from "vitest";
import { readPageFromLocation, writeUrlState } from "./site.js";

describe("site routing", () => {
  test("maps legacy and canonical paths to the same page", () => {
    window.history.replaceState({}, "", "/methodology.html");
    expect(readPageFromLocation()).toBe("methodology");

    window.history.replaceState({}, "", "/methodology");
    expect(readPageFromLocation()).toBe("methodology");

    window.history.replaceState({}, "", "/methodology/");
    expect(readPageFromLocation()).toBe("methodology");
  });

  test("writes canonical folder URLs", () => {
    window.history.replaceState({}, "", "/index.html");
    writeUrlState("leaderboard", { gameId: "all", difficultyId: "all", modelId: "all" });
    expect(window.location.pathname).toBe("/");

    writeUrlState("play", { gameId: "all", difficultyId: "all", modelId: "all" });
    expect(window.location.pathname).toBe("/play/");
  });
});
