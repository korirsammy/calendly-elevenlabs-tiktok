
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

function getNextMonday(date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = (day === 0 ? 1 : 8 - day);
  result.setDate(result.getDate() + diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getStartOfWeek(date) {
  const result = new Date(date);
  const day = result.getDay();
  const diff = result.getDate() - day + (day === 0 ? -6 : 1);
  result.setDate(diff);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getDateRange(weekOffset = 0, specificDate = null) {
  const now = getCurrentTime().raw;
  const SAFETY_BUFFER_MS = 5 * 60 * 1000;
  const WORKDAY_START_HOUR = 9;
  const WORKDAY_END_HOUR = 17;

  if (specificDate) {
    const startTime = new Date(specificDate);
    const requestedDateStr = startTime.toDateString();
    const nowDateStr = now.toDateString();
    const isToday = (requestedDateStr === nowDateStr);

    if (isToday) {
      const nowPlusBuffer = new Date(now.getTime() + SAFETY_BUFFER_MS);
      const workingDayStart = new Date(specificDate);
      workingDayStart.setHours(WORKDAY_START_HOUR, 0, 0, 0);
      const workingDayEnd = new Date(specificDate);
      workingDayEnd.setHours(WORKDAY_END_HOUR, 0, 0, 0);

      if (nowPlusBuffer > workingDayStart) {
        startTime.setTime(nowPlusBuffer.getTime());
      } else {
        startTime.setTime(workingDayStart.getTime());
      }

      if (startTime > workingDayEnd) {
        startTime.setTime(workingDayEnd.getTime());
      }

      const endTime = workingDayEnd;
      return { startTime, endTime };
    } else {
      startTime.setHours(0, 0, 0, 0);
      const endTime = new Date(startTime);
      endTime.setHours(23, 59, 59, 999);
      return { startTime, endTime };
    }
  }

  if (weekOffset === 0) {
    const fullWeekStart = getStartOfWeek(now);
    const fullWeekEnd = new Date(fullWeekStart);
    fullWeekEnd.setDate(fullWeekStart.getDate() + 6);
    fullWeekEnd.setHours(23, 59, 59, 999);

    const schedulingBuffer = 3 * 60 * 60 * 1000;
    let apiStartTime = now > fullWeekStart ? now : fullWeekStart;
    if (apiStartTime < new Date(now.getTime() + schedulingBuffer)) {
      apiStartTime = new Date(now.getTime() + schedulingBuffer);
    }

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
    let slotEnd = slot.end_time ? new Date(slot.end_time) : new Date(slotStart.getTime() + eventDuration * 60 * 1000);
    
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

async function getEventTypes() {
  try {
    const response = await calendlyApi.get('/event_types');
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

module.exports = {
  getCurrentTime,
  getDateRange,
  getAvailabilityData,
  processAvailabilityToSummary,
  processTimeSlotsForPeriod,
  getEventTypes
};
