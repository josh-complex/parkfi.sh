import { Avatar, Style } from "@dicebear/core";
import botttsDefinition from "@dicebear/styles/bottts-neutral.json";

const style = new Style(botttsDefinition);

export function generateBotAvatar(seed: string): string {
  const avatar = new Avatar(style, { seed });
  return avatar.toDataUri();
}
