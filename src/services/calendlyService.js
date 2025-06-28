// src/services/calendlyService.js
const axios = require('axios');
const config = require('../config/environment');

// Create Calendly API client with authentication
const calendlyApi = axios.create({
  baseURL: config.calendly.baseUrl,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.calendly.apiToken}`
  }
});

/**
 * Gets the current time for availability calculations.
 * 
 * @param {String} timezone - Optional timezone (default: 'UTC')
 * @returns {Object} Current time information
 */
function getCurrentTime(timezone = 'UTC') {
  const now = new Date();
  return {
    timestamp: now.toISOString(),
    readable: now.toLocaleString('en-US', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      timeZone: timezone
    }),
    timezone: timezone,
    raw: now
  };
}

/**
 * Returns the next Monday after the given date.
 * 
 * @param {Date} date - Starting date
 * @returns {Date} Date of next Monday
 */
function getNextMonday(date) {
  const result = new Date(date);
  const day = result.getDay();
  // If Sunday (0) then diff = 1; otherwise diff = 8 - day.
  const diff = (day === 0 ? 1 : 8 - day);
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Returns the start (Monday) of the current week.
 * 
 * @param {Date} date - Date within the week
 * @returns {Date} First day of the week containing the date
 */
function getStartOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  // Adjust: if Sunday, subtract 6 days; otherwise, subtract (day - 1)
  const diff = result.getDate() - day + (day === 0 ? -6 : 1);
  result.setDate(diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Returns a date range based on the week offset and (optional) specific date.
 * 
 * @param {Number} weekOffset - Week offset from current week
 * @param {String} specificDate - Optional specific date
 * @returns {Object} Date range with start and end times
 */
function getDateRange(weekOffset = 0, specificDate = null) {
  const now = getCurrentTime().raw;
  const SAFETY_BUFFER_MS = 5 * 60 * 1000;    // 5 minutes
  const WORKDAY_START_HOUR = 9;             // 9 AM
  const WORKDAY_END_HOUR = 17;             // 5 PM

  // If a specific date is provided
  if (specificDate) {
    const startTime = new Date(specificDate);

    // Detect if specificDate is "today"
    const requestedDateStr = startTime.toDateString();
    const nowDateStr = now.toDateString();
    const isToday = (requestedDateStr === nowDateStr);

    if (isToday) {
      // "Today" logic:
      const nowPlusBuffer = new Date(now.getTime() + SAFETY_BUFFER_MS);

      // Set up working hours on the requested date
      const workingDayStart = new Date(specificDate);
      workingDayStart.setHours(WORKDAY_START_HOUR, 0, 0, 0);

      const workingDayEnd = new Date(specificDate);
      workingDayEnd.setHours(WORKDAY_END_HOUR, 0, 0, 0);

      // Clamp today's startTime to "now+buffer" or 9 AM, whichever is later
      if (nowPlusBuffer > workingDayStart) {
        startTime.setTime(nowPlusBuffer.getTime());
      } else {
        startTime.setTime(workingDayStart.getTime());
      }

      // If it's already past 5 PM, effectively no availability
      if (startTime > workingDayEnd) {
        startTime.setTime(workingDayEnd.getTime());
      }

      // End is always 5 PM for today
      const endTime = workingDayEnd;
      return { startTime, endTime };
    } else {
      // For future/past days: full day (00:00–23:59)
      startTime.setHours(0, 0, 0, 0);
      const endTime = new Date(startTime);
      endTime.setHours(23, 59, 59, 999);
      return { startTime, endTime };
    }
  }

  // For week-based requests
  if (weekOffset === 0) {
    // Current week
    const fullWeekStart = getStartOfWeek(now);
    const fullWeekEnd = new Date(fullWeekStart);
    fullWeekEnd.setDate(fullWeekStart.getDate() + 6);
    fullWeekEnd.setHours(23, 59, 59, 999);

    const schedulingBuffer = 3 * 60 * 60 * 1000; // 3 hours

    const minStartTime = new Date(now.getTime() + schedulingBuffer);
    
    // Check if it's weekend and close to week end
    const dayOfWeek = now.getDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const hoursUntilWeekEnd = (fullWeekEnd.getTime() - now.getTime()) / (1000 * 60 * 60);
    
    if (isWeekend && hoursUntilWeekEnd < 12) {
      // If it's weekend and less than 12 hours left in the week,
      // automatically move to next week
      const nextWeekStart = getNextMonday(now);
      const nextWeekEnd = new Date(nextWeekStart);
      nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
      nextWeekEnd.setHours(23, 59, 59, 999);
      
      return {
        startTime: nextWeekStart,
        endTime: nextWeekEnd,
        readable: {
          start: nextWeekStart.toLocaleString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
          }),
          end: nextWeekEnd.toLocaleString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
          })
        }
      };
    }

    let apiStartTime = now > fullWeekStart ? now : fullWeekStart;
    if (apiStartTime < minStartTime) {
      apiStartTime = minStartTime;
    }

    // Ensure startTime is never after endTime
    if (apiStartTime > fullWeekEnd) {
      apiStartTime = fullWeekEnd;
    }

    return {
      startTime: apiStartTime,
      endTime: fullWeekEnd,
      readable: {
        start: fullWeekStart.toLocaleString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        }),
        end: fullWeekEnd.toLocaleString('en-US', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        })
      }
    };
  } else {
    // Future week
    let nextMonday = getNextMonday(now);
    if (weekOffset > 1) {
      nextMonday.setDate(nextMonday.getDate() + (weekOffset - 1) * 7);
    }
    
    const startTime = new Date(nextMonday);
    const endTime = new Date(startTime);
    endTime.setDate(startTime.getDate() + 6);
    endTime.setHours(23, 59, 59, 999);
    
    return { 
      startTime,
      endTime,
      readable: {
        start: startTime.toLocaleString('en-US', { 
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
        }),
        end: endTime.toLocaleString('en-US', { 
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
        })
      }
    };
  }
}

/**
 * Gets available time slots from Calendly API.
 * 
 * @param {String} eventType - Calendly event type URI
 * @param {Date} startTime - Start of the time range
 * @param {Date} endTime - End of the time range
 * @returns {Promise<Object>} Availability response
 */
async function getAvailabilityData(eventType, startTime, endTime) {
  try {
    console.log(`Fetching availability for event type: ${eventType}`);
    console.log(`Time range: ${startTime.toISOString()} to ${endTime.toISOString()}`);
    
    const response = await calendlyApi.get('/event_type_available_times', {
      params: {
        event_type: eventType,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString()
      }
    });
    
    console.log(`Received ${response.data.collection?.length || 0} available time slots`);
    return response.data;
  } catch (error) {
    console.error('Error fetching availability:', error.response?.data || error);
    throw new Error('Failed to fetch availability');
  }
}

/**
 * Processes availability data into day-based summary.
 * 
 * @param {Object} availabilityData - Raw availability data from API
 * @returns {Object} Processed availability summary
 */
function processAvailabilityToSummary(availabilityData) {
  const summary = {};
  
  availabilityData.collection.forEach(slot => {
    const date = new Date(slot.start_time);
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const hour = date.getUTCHours();
    
    if (!summary[dayName]) {
      summary[dayName] = {
        morning: "NO",
        afternoon: "NO",
        date: date.toISOString().split('T')[0]
      };
    }
    
    if (hour >= 5 && hour < 12) {
      summary[dayName].morning = "YES";
    } else if (hour >= 12 && hour < 17) {
      summary[dayName].afternoon = "YES";
    }
  });
  
  return summary;
}

/**
 * Processes availability data into time slots for a specific period.
 * 
 * @param {Object} availabilityData - Raw availability data from API
 * @param {String} period - Period of the day (morning/afternoon)
 * @param {Number} eventDuration - Duration of the event in minutes
 * @returns {Array} Processed time slots
 */
function processTimeSlotsForPeriod(availabilityData, period, eventDuration = 30) {
  const periodSlots = availabilityData.collection.filter(slot => {
    const hour = new Date(slot.start_time).getUTCHours();
    return period === 'morning'
      ? (hour >= 5 && hour < 12)
      : (hour >= 12 && hour < 17);
  });

  let processedSlots = [];
  periodSlots.forEach(slot => {
    const slotStart = new Date(slot.start_time);
    let slotEnd;
    if (slot.end_time) {
      slotEnd = new Date(slot.end_time);
    } else {
      const defaultBlockDuration = (eventDuration === 60) ? 60 : 30;
      slotEnd = new Date(slotStart.getTime() + defaultBlockDuration * 60 * 1000);
    }
    
    let currentTime = new Date(slotStart);
    while (currentTime < slotEnd) {
      processedSlots.push({
        time: currentTime.toLocaleTimeString('en-US', { 
          hour: 'numeric', minute: '2-digit', timeZone: 'UTC'
        }),
        timestamp: currentTime.toISOString(),
        scheduling_url: slot.scheduling_url
      });
      currentTime = new Date(currentTime.getTime() + eventDuration * 60 * 1000);
    }
  });

  processedSlots.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return processedSlots;
}

/**
 * Gets all event types for a user's Calendly account.
 * 
 * @returns {Promise<Array>} List of event types
 */
async function getEventTypes() {
  try {
    // Auto-discover the user UUID
    const userUuid = await getCurrentUser();
    
    // Use the discovered UUID in the request
    const response = await calendlyApi.get('/event_types', {
      params: {
        user: `https://api.calendly.com/users/${userUuid}`
      }
    });
    
    return response.data.collection.map(event => ({
      id: event.uri,
      name: event.name,
      duration: event.duration,
      description: event.description_plain || '',
      url: event.scheduling_url
    }));
  } catch (error) {
    console.error('Error fetching event types:', error.response?.data || error);
    throw new Error('Failed to fetch Calendly event types');
  }
}

/**
 * Gets the current user's information from Calendly.
 * 
 * @returns {Promise<String>} The user's UUID
 */
async function getCurrentUser() {
  try {
    const response = await calendlyApi.get('/users/me');
    // Extract UUID from the full URI (https://api.calendly.com/users/{uuid})
    const userUuid = response.data.resource.uri.split('/').pop();
    console.log(`Discovered Calendly user UUID: ${userUuid}`);
    return userUuid;
  } catch (error) {
    console.error('Error discovering Calendly user:', error.response?.data || error);
    throw new Error('Failed to discover Calendly user. Check your API token.');
  }
}

module.exports = {
  getCurrentTime,
  getDateRange,
  getAvailabilityData,
  processAvailabilityToSummary,
  processTimeSlotsForPeriod,
  getEventTypes,
  getCurrentUser  
};