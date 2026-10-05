import { describe, expect, it } from "vitest";
import { backdropMode, type DeviceFacts } from "./device.ts";

const laptop: DeviceFacts = { reducedMotion: false, width: 1440, finePointer: true, saveData: false, webgl: "hardware", memoryGb: 8 };

describe("the landing backdrop", () => {
  it("runs the live yacht on a laptop with a GPU", () => {
    expect(backdropMode(laptop)).toBe("live");
    expect(backdropMode({ ...laptop, memoryGb: undefined })).toBe("live");
  });

  it("holds the poster still when motion is unwelcome", () => {
    expect(backdropMode({ ...laptop, reducedMotion: true })).toBe("still");
  });

  it("drifts the poster on phones, without WebGL, in software, on small memory or to save data", () => {
    expect(backdropMode({ ...laptop, width: 390, finePointer: false })).toBe("drift");
    expect(backdropMode({ ...laptop, finePointer: false })).toBe("drift");
    expect(backdropMode({ ...laptop, webgl: "none" })).toBe("drift");
    expect(backdropMode({ ...laptop, webgl: "software" })).toBe("drift");
    expect(backdropMode({ ...laptop, memoryGb: 2 })).toBe("drift");
    expect(backdropMode({ ...laptop, saveData: true })).toBe("drift");
  });
});
