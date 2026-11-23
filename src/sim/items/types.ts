/**
 * Item definitions shared by the simulation, the TV renderer and the phone.
 * Pure data (no DOM, no Three.js), so it can be imported anywhere.
 *
 * All names are original. Roles (for readers who know other kart games):
 *   dash     = speed boost (single use, or a triple pack with 3 charges)
 *   slick    = a peel dropped on the road (shown to players as "Peel"; the id stays `slick` so the
 *              network protocol and saved data keep working); spins out whoever drives over it,
 *              can be dragged behind you as a shield
 *   ricochet = straight bouncing projectile (forward or backward, bounces off walls)
 *   seeker   = homing projectile that chases the racer ahead of you
 *   nova     = temporary invincibility: faster, ignores grass, knocks others aside
 *   jumble   = ink spray: the (two) racers just AHEAD of you get their steering flipped for a few
 *              seconds and an ink splat over their screen (a rare comeback item: only karts well
 *              behind get it)
 *   storm    = lightning: a dark cloud shocks every racer AHEAD of you at once: they lose their item,
 *              spin out and shrink to a tiny size (slower, lighter, easy to bump). The furthest-back
 *              victim grows back first, the leader last (about ten seconds). Rare, back markers only.
 *   rocket   = your kart becomes a rocket: driven automatically along the track at very high speed for
 *              a few seconds, invincible, knocking other karts aside. Only for karts far back.
 *
 * The id list order is what travels over the network. New ids go at the END; `storm` and `rocket`
 * took over the slots of two retired items (index 6 and 7), so the list length did not change.
 */
export const ITEM_IDS = ['dash', 'slick', 'ricochet', 'seeker', 'nova', 'jumble', 'storm', 'rocket'] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export const ITEM_INFO: Record<ItemId, { name: string; blurb: string }> = {
  dash: { name: 'Dash', blurb: 'A burst of speed. Comes as a single or a pack of three.' },
  slick: { name: 'Peel', blurb: 'Banana-style peel: spins out whoever drives over it. Drag it behind you to block shots.' },
  ricochet: { name: 'Ricochet', blurb: 'Fires straight and bounces off walls. Hold BRAKE when firing to shoot backward.' },
  seeker: { name: 'Seeker', blurb: 'Homing shot that chases the racer ahead of you.' },
  nova: { name: 'Nova', blurb: 'Brief invincibility: faster, ignores grass, knocks rivals aside.' },
  jumble: { name: 'Jumble', blurb: 'Inks the two racers just ahead of you: their steering flips left/right for a few seconds.' },
  storm: { name: 'Storm', blurb: 'A dark cloud shocks everyone ahead of you: they drop their item, spin out and shrink.' },
  rocket: { name: 'Rocket', blurb: 'Turns your kart into a rocket: auto-driven at huge speed along the track, knocking rivals aside.' },
};

/** What a player is carrying. `count` > 1 only for the Dash pack. */
export interface HeldItem {
  id: ItemId;
  count: number;
}

/** A moving or placed item object in the world (for the renderer). */
/** Things that exist in the world on their own. (The rocket and the storm are effects ON karts: see KartState.) */
export type ItemEntityKind = 'slick' | 'ricochet' | 'seeker';

export interface ItemEntity {
  /** Unique, stable id (use it to match meshes between frames). */
  uid: number;
  kind: ItemEntityKind;
  x: number;
  y: number;
  z: number;
  /** Direction of travel in radians (same convention as kart heading: 0 faces +Z). */
  heading: number;
  /** Player slot that created it. */
  owner: number;
  /** True while a Slick is being dragged behind its owner (it follows the kart). */
  trailing: boolean;
  /**
   * Ground tilt for things that lie on the road (the Peel): pitch is the nose-up/down angle and
   * roll the sideways tilt, in the object's own heading frame (same signs as a kart's body tilt).
   */
  pitch?: number;
  roll?: number;
}

/** A floating item box on the track. */
export interface ItemBox {
  x: number;
  y: number;
  z: number;
  /** Distance along the track (m). */
  s: number;
  /** False while waiting to respawn after being collected. */
  active: boolean;
  /** Seconds until it comes back. */
  respawn: number;
}

/** How long the item roulette spins before the item is revealed (s). */
export const ROULETTE_SECONDS = 1.6;
