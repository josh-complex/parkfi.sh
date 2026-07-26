import { describe, expect, it } from "vite-plus/test";

import { rideTagGroups } from "./ride-tags.ts";

describe("rideTagGroups", () => {
  it("collapses Disney's age tiers into one open-ended range", () => {
    // Seven Dwarfs Mine Train's real tag set.
    const g = rideTagGroups([
      "Thrill Rides",
      "Small Drops",
      "New",
      "Disney Princesses",
      "Kids",
      "Adults",
      "Teens",
      "Tweens",
      "PhotoPass",
    ]);
    expect(g.ageLabel).toBe("Ages 5+");
    expect(g.perks).toEqual(["PhotoPass"]);
    // Ride format first, then themes, then the unknown label.
    expect(g.descriptors).toEqual(["Thrill Rides", "Small Drops", "Disney Princesses", "New"]);
  });

  it("reads Universal's published age bands, en dash and all", () => {
    const g = rideTagGroups(["Kids (Under 7)", "Tweens (7–12)", "Teens (13–17)"]);
    expect(g.ageLabel).toBe("Ages 17 & under");
  });

  it("treats an open-ended tier as no ceiling", () => {
    expect(rideTagGroups(["Preschoolers", "Adults"]).ageLabel).toBe("All ages");
    expect(rideTagGroups(["All Ages"]).ageLabel).toBe("All ages");
    expect(rideTagGroups(["Fun For Little Ones"]).ageLabel).toBe("Ages 6 & under");
    expect(rideTagGroups(["Fun For Grownups"]).ageLabel).toBe("Ages 18+");
  });

  it("has no age chip when the operator published no age tier", () => {
    expect(rideTagGroups(["Water Rides"]).ageLabel).toBeNull();
    expect(rideTagGroups([]).ageLabel).toBeNull();
  });

  it("folds cross-operator alias forms into one chip", () => {
    const g = rideTagGroups(["Thrill", "Universal Thrills", "Thrill Rides", "Water", "Water Ride"]);
    expect(g.descriptors).toEqual(["Thrill Rides", "Water Rides"]);
    expect(rideTagGroups(["3-D", "4-D Experience", "3d 4d Experience"]).descriptors).toEqual([
      "3D / 4D",
    ]);
  });

  it("strips Disney's entity-type qualifier off a known theme", () => {
    const g = rideTagGroups(["Frozen Entertainment", "Frozen", "Star Wars Entertainment"]);
    expect(g.descriptors).toEqual(["Frozen", "Star Wars"]);
    // "Live Entertainment" is a show format, not a qualified theme — the
    // suffix strip must not eat it.
    expect(rideTagGroups(["Live Entertainment"]).descriptors).toEqual(["Live Entertainment"]);
  });

  it("keeps unknown labels rather than dropping them, but ranks them last", () => {
    const g = rideTagGroups(["Some New Operator Tag", "Avatar", "Spinning"]);
    expect(g.descriptors).toEqual(["Spinning", "Avatar", "Some New Operator Tag"]);
  });

  it("drops contentless marketing filler", () => {
    expect(rideTagGroups(["Experience", "Multi- Person", "Entertainment"]).descriptors).toEqual([]);
  });

  it("routes actionable labels to the perk row", () => {
    const g = rideTagGroups(["Single Rider Offered", "Play Disney Parks", "Dark"]);
    expect(g.perks).toEqual(["Single rider", "Play Disney Parks"]);
    expect(g.descriptors).toEqual(["Dark"]);
  });
});
