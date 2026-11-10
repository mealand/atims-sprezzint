/**
 * Sprezz Integrated Limited — brand tokens for ATiMs.
 * Source: Sprezz logo (crimson diamond; green/purple/yellow/blue arrows).
 * Single source of truth; CSS vars in styles.css mirror these.
 */
export const brand = {
  company: 'Sprezz Integrated Limited',
  product: 'ATiMs',
  colors: {
    /** Crimson diamond — primary action / headers */
    primary: '#A81D1D',
    primaryDark: '#7E1414',
    /** Green arrow — success / verified states */
    green: '#4CAF50',
    /** Purple arrow — inspector / certification roles */
    purple: '#A349A4',
    /** Yellow arrow — attention / pending states */
    yellow: '#F5C51D',
    /** Blue arrow — information / trace links */
    blue: '#2392DF',
    ink: '#1A1A1A',   // logo outline black
    paper: '#FAF7F2', // warm off-white canvas
  },
  roleColors: {
    farmer: '#4CAF50',
    aggregator: '#F5C51D',
    processor: '#2392DF',
    exporter: '#A349A4',
    lab: '#A349A4',
    inspector: '#2392DF',
    regulator: '#2392DF',
    admin: '#A81D1D',
  },
} as const;

export type BrandColor = keyof typeof brand.colors;
