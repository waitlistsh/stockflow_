/**
 * Calculates inventory health with support for Strategic Overrides.
 * @param {number} stock - The current stock level
 * @param {number} velocity - Statistical sales per day (moving average)
 * @param {number|null} override - Manual override velocity (strategic input)
 */
export const calculateInventoryHealth = (stock, velocity, override) => {
  // Use the override velocity if it exists; otherwise, use the statistical average
  const effectiveVelocity = (override !== null && override !== undefined) ? Number(override) : velocity;

  // 1. OUT OF STOCK CHECK
  if (stock <= 0) {
    return {
      runwayText: '0 Days',
      riskLabel: 'OUT OF STOCK',
      riskColor: 'bg-red-100 text-red-800 border-red-200', 
    };
  }

  // 2. STAGNANT CHECK (Stock exists, but no sales after override)
  if (effectiveVelocity <= 0) {
    return {
      runwayText: 'No Sales',
      riskLabel: 'STAGNANT',
      riskColor: 'bg-gray-100 text-gray-800 border-gray-200',
    };
  }
  
  // 3. STANDARD CALCULATION BASED ON EFFECTIVE VELOCITY
  const runwayDays = stock / effectiveVelocity;

  if (runwayDays <= 14) {
    return {
      runwayText: `${Math.floor(runwayDays)} Days`,
      riskLabel: 'HIGH',
      riskColor: 'bg-red-100 text-red-800 border-red-200',
    };
  } else if (runwayDays <= 30) {
    return {
      runwayText: `${Math.floor(runwayDays)} Days`,
      riskLabel: 'MEDIUM',
      riskColor: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    };
  } else {
    return {
      runwayText: `${Math.floor(runwayDays)} Days`,
      riskLabel: 'LOW',
      riskColor: 'bg-green-100 text-green-800 border-green-200',
    };
  }
};