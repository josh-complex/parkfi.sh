/**
 * Tracks whether the app has finished its initial load (cold launch / hard
 * reload) versus a later in-app navigation.
 *
 * Used by the "/" route to send mobile + native users to the map *only* on
 * launch — never when they later tap the Waits tab, which also routes to "/".
 * `markLaunched` is called once from the root shell's first effect, which runs
 * after the initial route resolution (and thus after that launch-time redirect
 * decision) has already happened.
 */
let launched = false;

export const hasLaunched = (): boolean => launched;

export const markLaunched = (): void => {
  launched = true;
};
