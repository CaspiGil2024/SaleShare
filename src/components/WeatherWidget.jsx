import { useEffect, useMemo, useRef, useState } from 'react';
import { Wind, Waves, Gauge, Timer, RefreshCw, ArrowUp } from 'lucide-react';

// Herzliya Marina.
const LATITUDE = 32.1656;
const LONGITUDE = 34.7847;

const DAYS_TO_SHOW = 7;
const HOURS_TO_FETCH = DAYS_TO_SHOW * 24;

// Free, no API key required — verified live against these exact
// endpoints/params before building this (Open-Meteo forecast + marine).
// wind_speed_unit=kn matches the reference design's knots display.
const WEATHER_URL = `https://api.open-meteo.com/v1/forecast?latitude=${LATITUDE}&longitude=${LONGITUDE}&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code&wind_speed_unit=kn&timezone=Asia%2FJerusalem`;
const WEATHER_HOURLY_URL = `https://api.open-meteo.com/v1/forecast?latitude=${LATITUDE}&longitude=${LONGITUDE}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&forecast_days=${DAYS_TO_SHOW}&timezone=Asia%2FJerusalem`;
const MARINE_URL = `https://marine-api.open-meteo.com/v1/marine?latitude=${LATITUDE}&longitude=${LONGITUDE}&current=wave_height,wave_direction,wave_period&timezone=Asia%2FJerusalem`;
const MARINE_HOURLY_URL = `https://marine-api.open-meteo.com/v1/marine?latitude=${LATITUDE}&longitude=${LONGITUDE}&hourly=wave_height&forecast_days=${DAYS_TO_SHOW}&timezone=Asia%2FJerusalem`;

function StatCard({ icon: Icon, label, value, unit }) {
  return (
    <div className="rounded-xl bg-white/15 px-4 py-3.5 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-sky-50">
        <Icon size={15} />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-3xl font-extrabold leading-tight">
        {value}
        {unit && <span className="text-base font-bold ms-1">{unit}</span>}
      </p>
    </div>
  );
}

// --- Series building: slice to the next HOURS_TO_FETCH hours from now,
// filter to 3-hour marks (always keeping the true "now" bar even if
// it doesn't land on one), group into calendar-day columns. ---

function isSameHour(a, b) {
  return a.getHours() === b.getHours() && a.toDateString() === b.toDateString();
}

function buildWaveSeries(hourly) {
  if (!hourly?.time || !hourly?.wave_height) return [];
  const now = new Date();
  const startIndex = hourly.time.findIndex((t) => new Date(t) >= now);
  const fromIndex = startIndex === -1 ? 0 : startIndex;

  return hourly.time.slice(fromIndex, fromIndex + HOURS_TO_FETCH).map((t, i) => {
    const time = new Date(t);
    return { time, waveHeight: hourly.wave_height[fromIndex + i], isNow: isSameHour(time, now) };
  });
}

function buildWindSeries(hourly) {
  if (!hourly?.time || !hourly?.wind_speed_10m) return [];
  const now = new Date();
  const startIndex = hourly.time.findIndex((t) => new Date(t) >= now);
  const fromIndex = startIndex === -1 ? 0 : startIndex;

  return hourly.time.slice(fromIndex, fromIndex + HOURS_TO_FETCH).map((t, i) => {
    const time = new Date(t);
    return {
      time,
      windSpeed: hourly.wind_speed_10m[fromIndex + i],
      windDirection: hourly.wind_direction_10m[fromIndex + i],
      isNow: isSameHour(time, now),
    };
  });
}

function filterToThreeHourMarks(series) {
  return series.filter((entry) => entry.isNow || entry.time.getHours() % 3 === 0);
}

function groupByDay(series) {
  const today = new Date().toDateString();
  const groups = [];
  for (const entry of series) {
    const dayKey = entry.time.toDateString();
    let group = groups[groups.length - 1];
    if (!group || group.dayKey !== dayKey) {
      group = { dayKey, isToday: dayKey === today, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

function dayHeaderLabel(group) {
  if (group.isToday) return 'היום';
  return group.entries[0].time.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' });
}

// Rough visual speed bands (knots) — not a meteorological standard,
// just enough contrast to make stronger wind pop out at a glance,
// matching the multi-color arrows in the reference design.
function windSpeedColorClass(knots) {
  if (knots >= 13) return 'text-amber-600 dark:text-amber-300';
  if (knots >= 8) return 'text-cyan-600';
  return 'text-emerald-600 dark:text-emerald-300';
}

export default function WeatherWidget() {
  const [weather, setWeather] = useState(null);
  const [marine, setMarine] = useState(null);
  const [waveSeries, setWaveSeries] = useState([]);
  const [windSeries, setWindSeries] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Keeps the wave and wind charts' horizontal scroll positions in
  // lockstep. isSyncingRef guards against the mirrored scrollLeft
  // assignment re-triggering this same handler on the other side —
  // without it, syncing A->B would immediately fire B's own onScroll
  // and try to sync B->A, back and forth.
  const waveScrollRef = useRef(null);
  const windScrollRef = useRef(null);
  const isSyncingRef = useRef(false);

  function syncScroll(source, target) {
    return () => {
      if (isSyncingRef.current || !source.current || !target.current) return;
      isSyncingRef.current = true;
      target.current.scrollLeft = source.current.scrollLeft;
      isSyncingRef.current = false;
    };
  }

  async function fetchConditions() {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      // cache: 'no-store' — without this, a repeat click of the refresh
      // button could silently serve a browser-cached response for the
      // same URL instead of hitting the network again.
      const [weatherRes, marineRes, weatherHourlyRes, marineHourlyRes] = await Promise.all([
        fetch(WEATHER_URL, { cache: 'no-store' }),
        fetch(MARINE_URL, { cache: 'no-store' }),
        fetch(WEATHER_HOURLY_URL, { cache: 'no-store' }),
        fetch(MARINE_HOURLY_URL, { cache: 'no-store' }),
      ]);
      if (!weatherRes.ok || !marineRes.ok || !weatherHourlyRes.ok || !marineHourlyRes.ok) {
        throw new Error('weather fetch failed');
      }
      const [weatherJson, marineJson, weatherHourlyJson, marineHourlyJson] = await Promise.all([
        weatherRes.json(),
        marineRes.json(),
        weatherHourlyRes.json(),
        marineHourlyRes.json(),
      ]);
      setWeather(weatherJson.current);
      setMarine(marineJson.current);
      setWaveSeries(buildWaveSeries(marineHourlyJson.hourly));
      setWindSeries(buildWindSeries(weatherHourlyJson.hourly));
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to load marine weather', err);
      setErrorMessage('לא ניתן לטעון את תנאי מזג האוויר כרגע.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    fetchConditions();
  }, []);

  const waveGroups = useMemo(() => groupByDay(filterToThreeHourMarks(waveSeries)), [waveSeries]);
  const windGroups = useMemo(() => groupByDay(filterToThreeHourMarks(windSeries)), [windSeries]);
  const maxWaveHeight = Math.max(...waveSeries.map((h) => h.waveHeight ?? 0), 0.5);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl bg-gradient-to-l from-sky-600 to-cyan-500 px-6 py-5 shadow-sm text-white">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold flex items-center gap-2">
            <Waves size={18} />
            תנאי שייט - הרצליה
          </h3>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-xs text-sky-100">
                עודכן {lastUpdated.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <button
              type="button"
              onClick={fetchConditions}
              disabled={isLoading}
              aria-label="רענון"
              className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/15 disabled:opacity-50"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {errorMessage ? (
          <p className="text-sm text-sky-50">{errorMessage}</p>
        ) : isLoading && !weather ? (
          <p className="text-sm text-sky-50">טוען נתונים...</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={Timer} label="מחזור גל" value={marine?.wave_period?.toFixed(1)} unit="שניות" />
            <StatCard icon={Waves} label="גובה גל (ממוצע)" value={marine?.wave_height?.toFixed(1)} unit="מ'" />
            <StatCard icon={Gauge} label="משבי רוח" value={Math.round(weather?.wind_gusts_10m ?? 0)} unit="קשר" />
            <StatCard
              icon={Wind}
              label="רוח"
              value={Math.round(weather?.wind_speed_10m ?? 0)}
              unit={`קשר (${Math.round(weather?.wind_direction_10m ?? 0)}°)`}
            />
          </div>
        )}
      </div>

      {!errorMessage && waveGroups.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Waves size={18} className="text-sky-600" />
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">תחזית גלים</h3>
            <span className="text-xs text-slate-400 dark:text-slate-500">גובה גל (מ') כל 3 שעות - {DAYS_TO_SHOW} ימים קדימה</span>
          </div>

          <div
            ref={waveScrollRef}
            onScroll={syncScroll(waveScrollRef, windScrollRef)}
            className="overflow-x-auto pb-1"
          >
            <div className="flex items-start gap-4 min-w-max px-1">
              {waveGroups.map((group) => (
                <div key={group.dayKey} className="flex flex-col gap-2">
                  <p className={`text-sm ${group.isToday ? 'font-extrabold text-blue-900 dark:text-blue-300' : 'font-bold text-slate-600 dark:text-slate-300'}`}>
                    {dayHeaderLabel(group)}
                  </p>
                  <div className="flex items-end gap-2 h-36 border-e border-slate-100 dark:border-slate-800 pe-4 last:border-e-0 last:pe-0">
                    {group.entries.map((h) => (
                      <div key={h.time.toISOString()} className="flex flex-col items-center gap-1.5 w-11 shrink-0">
                        <span className={`text-sm font-extrabold ${h.isNow ? 'text-blue-900 dark:text-blue-300' : 'text-blue-700 dark:text-blue-300'}`}>
                          {h.waveHeight.toFixed(1)}
                        </span>
                        <div className="w-full h-24 flex items-end">
                          <div
                            title={`${h.time.toLocaleTimeString('he-IL', { hour: '2-digit' })} — ${h.waveHeight.toFixed(1)} מ'`}
                            className={`w-full rounded-t-md transition-all ${
                              h.isNow ? 'bg-blue-700 ring-2 ring-blue-900 ring-offset-1 shadow-md' : 'bg-blue-400'
                            }`}
                            style={{ height: `${Math.max((h.waveHeight / maxWaveHeight) * 100, 6)}%` }}
                          />
                        </div>
                        <span className={`text-xs font-bold ${h.isNow ? 'text-blue-900 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}>
                          {h.isNow ? 'עכשיו' : h.time.toLocaleTimeString('he-IL', { hour: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!errorMessage && windGroups.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Wind size={18} className="text-sky-600" />
            <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">תחזית רוח</h3>
            <span className="text-xs text-slate-400 dark:text-slate-500">קשר וכיוון כל 3 שעות - {DAYS_TO_SHOW} ימים קדימה</span>
          </div>

          <div
            ref={windScrollRef}
            onScroll={syncScroll(windScrollRef, waveScrollRef)}
            className="overflow-x-auto pb-1"
          >
            <div className="flex items-start gap-4 min-w-max px-1">
              {windGroups.map((group) => (
                <div key={group.dayKey} className="flex flex-col gap-2">
                  <p className={`text-sm ${group.isToday ? 'font-extrabold text-blue-900 dark:text-blue-300' : 'font-bold text-slate-600 dark:text-slate-300'}`}>
                    {dayHeaderLabel(group)}
                  </p>
                  <div className="flex items-end gap-2 border-e border-slate-100 dark:border-slate-800 pe-4 last:border-e-0 last:pe-0">
                    {group.entries.map((h) => (
                      <div
                        key={h.time.toISOString()}
                        className={`flex flex-col items-center gap-1.5 w-11 shrink-0 rounded-lg py-2 ${
                          h.isNow ? 'bg-blue-50 dark:bg-blue-950 ring-2 ring-blue-700' : ''
                        }`}
                      >
                        <span className={`text-sm font-extrabold ${windSpeedColorClass(h.windSpeed)}`}>
                          {Math.round(h.windSpeed)}
                        </span>
                        <ArrowUp
                          size={22}
                          className={windSpeedColorClass(h.windSpeed)}
                          style={{ transform: `rotate(${h.windDirection}deg)` }}
                          title={`${Math.round(h.windDirection)}°`}
                        />
                        <span className={`text-xs font-bold ${h.isNow ? 'text-blue-900 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'}`}>
                          {h.isNow ? 'עכשיו' : h.time.toLocaleTimeString('he-IL', { hour: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
