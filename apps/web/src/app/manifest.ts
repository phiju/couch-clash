import type { MetadataRoute } from "next";

/** Web app manifest ("Zum Home-Bildschirm"): the Couch Clash sofa icon on the stage colour. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Couch Clash",
    short_name: "Couch Clash",
    description: "Die Partyspiel-Show fürs Wohnzimmer – ein Fernseher, alle Handys.",
    start_url: "/",
    display: "standalone",
    background_color: "#123F3C",
    theme_color: "#123F3C",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
