/**
 * Calculates inventory health.
 * @param {number} stock - The current stock level
 * @param {number} velocity - Sales per day
 */


export const calculateInventoryHealth = (stock, velocity) => {
  // 1. OUT OF STOCK CHECK
  if (stock <= 0) {
    return {
      runwayText: '0 Days',
      riskLabel: 'OUT OF STOCK',
      riskColor: 'bg-red-100 text-red-800 border-red-200', 
    };
  }

  // 2. STAGNANT CHECK (Stock exists, but no sales)
  if (velocity <= 0) {
    return {
      runwayText: 'No Sales',
      riskLabel: 'STAGNANT',
      riskColor: 'bg-gray-100 text-gray-800 border-gray-200',
    };
  }

  // 3. STANDARD CALCULATION
  const runwayDays = stock / velocity;

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