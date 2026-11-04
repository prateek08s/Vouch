// Live check against YouTube's real oEmbed endpoint (not part of the unit suite).
import { OEmbedProvider } from "../lib/youtube/metadata.ts";
const p = new OEmbedProvider();
for (const id of ["dQw4w9WgXcQ", "aaaaaaaaaaa"]) console.log(id, JSON.stringify(await p.fetch(id)));
