// Repairs packet timestamps on their way from a stream into an MP4.
//
// Streams rarely start at zero, a few have timestamps that run backwards by
// some milliseconds from one group of frames to the next, and an HLS
// discontinuity restarts the clock altogether. An MP4 muxer accepts none of
// that. Pure.

/** A change between two groups larger than this is a restarted clock, not jitter. */
const JUMP_SECONDS = 2;
/** Tracks whose first timestamps differ by less than this share one clock. */
const SHARED_CLOCK_SECONDS = 5;

/**
 * How much to subtract from each input's timestamps so playback starts at
 * zero. Inputs on one clock keep their offset to each other, which keeps audio
 * and video in sync. Inputs on unrelated clocks each start at zero.
 */
export function startOffsets(firsts: readonly number[]): number[] {
  const earliest = Math.min(...firsts);
  const shared = firsts.every((first) => first - earliest < SHARED_CLOCK_SECONDS);
  return shared ? firsts.map(() => earliest) : [...firsts];
}

export type Retimer = (timestamp: number, duration: number, isKey: boolean) => number;

/**
 * Returns a function that maps each packet's timestamp, in decode order, to
 * the one to write. Audio packets are all key packets.
 */
export function createRetimer(start: number): Retimer {
  let shift = -start;
  let earlierGroupsMax = -Infinity;
  let groupMax = -Infinity;
  let end = 0;

  return (timestamp, duration, isKey) => {
    let time = timestamp + shift;
    if (isKey) {
      const restarted = groupMax !== -Infinity && (time < groupMax - JUMP_SECONDS || time > end + JUMP_SECONDS);
      if (restarted) {
        shift += end - time;
        time = end;
      }
      earlierGroupsMax = Math.max(earlierGroupsMax, groupMax);
      groupMax = -Infinity;
    }
    // No frame may be shown before the last frame of an earlier group.
    time = Math.max(time, earlierGroupsMax, 0);
    groupMax = Math.max(groupMax, time);
    end = Math.max(end, time + duration);
    return time;
  };
}
