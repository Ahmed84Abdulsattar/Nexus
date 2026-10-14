/**
 * Initial view of the portfolio map (docs/09 section 3): centred on the UAE, about 24.4 N, 54.4 E,
 * zoom 7. Map settings, not site data.
 */
export const UAE_VIEW = { lat: 24.4, lng: 54.4, zoom: 7 } as const;

/** The UAE plus a margin, in WGS84 degrees. The 2D view cannot be panned outside it. */
export const UAE_EXTENT = { xmin: 50.0, ymin: 21.5, xmax: 58.0, ymax: 27.5 } as const;
