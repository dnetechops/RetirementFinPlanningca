// Tax and benefit rules used by the planner.
// Values are 2026 estimates (indexed from 2025 published figures). Verify each year on canada.ca
// and update here - every calculation reads from this one object.
window.TAXDATA = {
  year: 2026,

  federal: {
    // [top of bracket, rate]
    brackets: [[58523, 0.14], [117045, 0.205], [181440, 0.26], [258482, 0.29], [Infinity, 0.33]],
    creditRate: 0.14,
    bpaMax: 16452, bpaMin: 14829,         // basic personal amount shrinks between the 3rd and 4th bracket tops
    ageAmount: 9208, ageThreshold: 46432, // age 65+ credit, reduced 15% of net income above threshold
    pensionAmount: 2000,                  // pension income credit (not indexed)
    dtcEligible: 0.150198,                // eligible dividend tax credit, % of grossed-up dividend
  },

  provinces: {
    ON: {
      name: 'Ontario',
      brackets: [[53891, 0.0505], [107785, 0.0915], [150000, 0.1116], [220000, 0.1216], [Infinity, 0.1316]],
      creditRate: 0.0505, bpa: 12989, ageAmount: 6341, ageThreshold: 47210, pensionAmount: 1796,
      dtcEligible: 0.10,
      surtax: [[5818, 0.20], [7446, 0.36]], // % of basic Ontario tax above each threshold
      healthPremium: true,
    },
    BC: {
      name: 'British Columbia',
      brackets: [[50363, 0.056], [100728, 0.077], [115648, 0.105], [140430, 0.1229], [190405, 0.147], [265545, 0.168], [Infinity, 0.205]],
      creditRate: 0.056, bpa: 13216, ageAmount: 5927, ageThreshold: 44119, pensionAmount: 1000,
      dtcEligible: 0.12,
    },
    AB: {
      name: 'Alberta',
      brackets: [[61200, 0.08], [154259, 0.10], [185111, 0.12], [246813, 0.13], [370220, 0.14], [Infinity, 0.15]],
      creditRate: 0.10, bpa: 22769, ageAmount: 6345, ageThreshold: 47234, pensionAmount: 1753,
      dtcEligible: 0.0812,
    },
  },

  oas: {
    maxMonthly65: 740,          // max OAS, age 65-74 (today's $). Check canada.ca for the current quarter.
    clawbackThreshold: 95323,   // OAS recovery tax starts above this net income
    clawbackRate: 0.15,
    deferralPerMonth: 0.006,    // +0.6% per month deferred past 65, max 60 months (+36%)
    boost75: 0.10,              // +10% from age 75
  },

  cpp: {
    earlyPerMonth: 0.006,       // -0.6% per month before 65 (min age 60)
    latePerMonth: 0.007,        // +0.7% per month after 65 (max age 70)
    max65Monthly: 1507.65,
  },

  gcapInclusion: 0.5,
  divGrossUp: 1.38,             // eligible dividends
  tfsaLimit: 7000,

  // CRA prescribed RRIF minimum factors (age at Jan 1). Under 71: 1 / (90 - age).
  rrifFactors: {
    71: 0.0528, 72: 0.0540, 73: 0.0553, 74: 0.0567, 75: 0.0582, 76: 0.0598, 77: 0.0617, 78: 0.0636,
    79: 0.0658, 80: 0.0682, 81: 0.0708, 82: 0.0738, 83: 0.0771, 84: 0.0808, 85: 0.0851, 86: 0.0899,
    87: 0.0955, 88: 0.1021, 89: 0.1099, 90: 0.1192, 91: 0.1306, 92: 0.1449, 93: 0.1634, 94: 0.1879,
    95: 0.2000,
  },

  // Withholding tax on RRSP lump sums / RRIF amounts above the minimum (outside Quebec).
  // This is a prepayment, not the final tax - it is settled on your return.
  withholding: [[5000, 0.10], [15000, 0.20], [Infinity, 0.30]],
};
