/**
 * Item definitions shared by the simulation, the TV renderer and the phone.
 * Pure data (no DOM, no Three.js), so it can be imported anywhere.
 *
 * All names are original. Roles (for readers who know other kart games):
 *   dash     = speed boost (single use, or a triple pack with 3 charges)
 *   slick    = slippery trap dropped on the road; can be dragged behind you as a shield
 *   ricochet = straight bouncing projectile (forward or backward, bounces off walls)
 *   seeker   = homing projectile that chases the racer ahead of you
 *   nova     = temporary invincibility: faster, ignores grass, knocks others aside
 *   jumble   = ink spray: every racer AHEAD of you gets their steering flipped for a few
 *              seconds and an ink splat over their screen (a comeback item: you can't
 *              get it in the lead)
 */
export const ITEM_IDS = ['dash', 'slick', 'ricochet', 'seeker', 'nova', 'jumble'] as const;
export type ItemId = (typeof ITEM_IDS)[number];

export const ITEM_INFO: Record<ItemId, { name: string; blurb: string }> = {
  dash: { name: 'Dash', blurb: 'A burst of speed. Comes as a single or a pack of three.' },
  slick: { name: 'Slick', blurb: 'Oil slick: spins out whoever drives over it. Drag it behind you to block shots.' },
  ricochet: { name: 'Ricochet', blurb: 'Fires straight and bounces off walls. Hold BRAKE when firing to shoot backward.' },
  seeker: { name: 'Seeker', blurb: 'Homing shot that chases the racer ahead of you.' },
  nova: { name: 'Nova', blurb: 'Brief invincibility: faster, ignores grass, knocks rivals aside.' },
  jumble: { name: 'Jumble', blurb: 'Inks everyone ahead of you: their steering flips left/right for a few seconds.' },
};

/** What a player is carrying. `count` > 1 only for the Dash pack. */
export interface HeldItem {
  id: ItemId;
  count: number;
}

/** A moving or placed item object in the world (for the renderer). */
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
