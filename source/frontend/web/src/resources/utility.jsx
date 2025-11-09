function ConvertUtcToLocal(utcTimestamp) {
  const utcDate = new Date(utcTimestamp);
  const localTimestamp = utcDate.toLocaleString();

  return localTimestamp;
}

function CalculateTimeDifference(targetEpoch) {
  const currentEpoch = Math.floor(Date.now() / 1000); // Current epoch time in seconds

  const timeDifference = currentEpoch - targetEpoch;

  const days = Math.floor(timeDifference / (60 * 60 * 24));
  const hours = Math.floor((timeDifference % (60 * 60 * 24)) / (60 * 60));
  const minutes = Math.floor((timeDifference % (60 * 60)) / 60);
  const seconds = Math.floor((timeDifference % (60)));

  let result = "";
  if (days > 0)
    result = `${days} days, `
  if (result.length > 0 || hours > 0)
    result = result + `${hours} hours, `
  if (result.length > 0 || minutes > 0)
    result = result + `${minutes} minutes, `
  if (result.length > 0 || seconds > 0)
    result = result + `${seconds} seconds`
  return result + ' ago';
}

function DecimalToTimestamp(decimalSeconds) {
  if (decimalSeconds === undefined || decimalSeconds === null || decimalSeconds < 0) return "";
  
  const hours = Math.floor(decimalSeconds / 3600);
  const minutes = Math.floor((decimalSeconds % 3600) / 60);
  const seconds = Math.floor(decimalSeconds % 60);
  const milliseconds = Math.round((decimalSeconds % 1) * 1000);

  const formattedHours = hours.toString().padStart(2, '0');
  const formattedMinutes = minutes.toString().padStart(2, '0');
  const formattedSeconds = seconds.toString().padStart(2, '0');
  const formattedMilliseconds = milliseconds.toString().padStart(3, '0');

  return `${formattedHours}:${formattedMinutes}:${formattedSeconds}.${formattedMilliseconds}`;
  //return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

function FormatSeconds(seconds) {
  seconds = parseInt(seconds);
  var hours = Math.floor(seconds / 3600);
  var minutes = Math.floor((seconds % 3600) / 60);
  var remainingSeconds = seconds % 60;

  var result = '';
  if (hours > 0) {
      result += hours + ' hour' + (hours > 1 ? 's' : '') + ', ';
  }
  if (minutes > 0) {
      result += minutes + ' minute' + (minutes > 1 ? 's' : '') + ', ';
  }
  if (remainingSeconds > 0) {
      result += remainingSeconds + ' second' + (remainingSeconds > 1 ? 's' : '');
  }

  return result;
}

function CombineAndDedupArrays(...arrays) {
  // Merge arrays
  const combinedArray = [].concat(...arrays);
  
  // Convert the combined array to a Set to remove duplicates
  const uniqueArray = [...new Set(combinedArray)];
  
  return uniqueArray;
}

function IsValidNumber(str) {
  if (str === null || str === undefined || str.length === 0)
    return true;

  str = str.toString();
  // Check if the string is empty or only contains whitespace
  if (!str.trim()) {
    return false;
  }

  // Use the Number constructor to check if the string is a valid number
  const num = Number(str);

  // Check if the result is NaN
  if (isNaN(num)) {
    return false;
  }

  // Check for valid number format (integer or decimal)
  const regex = /^-?\d+(\.\d*)?$/;
  return regex.test(str);
}

function clusterDataByDistance(data) {
        if (!data || data.length === 0) {
            return [];
        }

        // Extract distances and sort them
        const distances = data.map(item => item.Distance).sort((a, b) => a - b);
        
        // Determine clustering approach based on data distribution
        let thresholds;
        
        if (distances.length <= 2) {
            // For very small datasets, use simple binary classification
            const midpoint = (distances[0] + distances[distances.length - 1]) / 2;
            thresholds = { low: midpoint };
        } else {
            // Use k-means-like approach to find natural clusters
            const min = distances[0];
            const max = distances[distances.length - 1];
            const range = max - min;
            
            if (range < 0.2) {
            // If all distances are very close, use binary classification
            const midpoint = (min + max) / 2;
            thresholds = { low: midpoint };
            } else {
            // Use tertile-based clustering with some adjustment for natural breaks
            const third = range / 3;
            thresholds = {
                low: min + third,
                medium: min + (2 * third)
            };
            }
        }
        
        // Apply categories to each item
        return data.map(item => {
            let category;
            
            if (thresholds.medium) {
            // Three categories
            if (item.Distance <= thresholds.low) {
                category = 'high'; // Lower distance = higher similarity
            } else if (item.Distance <= thresholds.medium) {
                category = 'medium';
            } else {
                category = 'low';
            }
            } else {
            // Two categories
            if (item.Distance <= thresholds.low) {
                category = 'high';
            } else {
                category = 'low';
            }
            }
            
            return {
            ...item,
            Category: category
            };
        });
      }
export {ConvertUtcToLocal, CalculateTimeDifference, DecimalToTimestamp, FormatSeconds, CombineAndDedupArrays, IsValidNumber, clusterDataByDistance};