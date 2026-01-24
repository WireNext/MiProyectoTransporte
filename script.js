/**
 * Normaliza nombres para evitar duplicados visuales
 */
const normalizar = (t) => t ? t.toLowerCase().replace(/[-]/g, ' ').trim() : '';

/**
 * Parsea el CSV
 */
function parsearCSV(csvText) {
    if (!csvText) return [];
    const lineas = csvText.trim().split(/\r?\n/);
    if (lineas.length <= 1) return [];
    const cabeceras = lineas[0].split(',').map(h => h.trim());
    return lineas.slice(1).map(linea => {
        const valores = linea.split(',');
        const obj = {};
        cabeceras.forEach((h, i) => {
            obj[h] = valores[i] ? valores[i].trim().replace(/^"(.*)"$/, '$1') : '';
        });
        return obj;
    }).filter(o => Object.keys(o).length === cabeceras.length);
}

/**
 * Filtra los service_id activos según el día de la semana actual
 */
function obtenerServiciosActivos(calendar) {
    const diasSemana = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const ahora = new Date();
    const nombreDiaHoy = diasSemana[ahora.getDay()];
    const fechaActual = ahora.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD

    return calendar.filter(s => {
        const circulaHoy = s[nombreDiaHoy] === '1';
        const enFecha = fechaActual >= s.start_date && fechaActual <= s.end_date;
        return circulaHoy && enFecha;
    }).map(s => s.service_id);
}

async function cargarDatosGTFS() {
    try {
        const [routes, trips, stops, stopTimes, shapes, calendar] = await Promise.all([
            fetch('gtfs/routes.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/trips.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/stops.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/stop_times.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/shapes.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/calendar.txt').then(r => r.text()).then(parsearCSV)
        ]);

        const serviciosActivos = obtenerServiciosActivos(calendar);
        iniciarMapa(stops, stopTimes, trips, routes, shapes, serviciosActivos);
    } catch (e) {
        console.error("Error cargando GTFS:", e);
    }
}

function iniciarMapa(stops, stopTimes, trips, routes, shapesArray, serviciosActivos) {
    const map = L.map('map').setView([39.9864, -0.0513], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    const clusterGroup = L.markerClusterGroup();
    const busIcon = L.divIcon({
        html: `<div style="background:#0078A8; border-radius:50%; width:24px; height:24px; border:2px solid white; display:flex; justify-content:center; align-items:center; color:white; font-size:12px;">🚌</div>`,
        className: '', iconSize: [24, 24], iconAnchor: [12, 12]
    });

    stops.forEach(stop => {
        const marker = L.marker([parseFloat(stop.stop_lat), parseFloat(stop.stop_lon)], { icon: busIcon });

        marker.on('click', function(e) {
            const ahora = new Date();
            const horaActualEnMinutos = ahora.getHours() * 60 + ahora.getMinutes();

            const horarios = stopTimes
                .filter(st => st.stop_id === stop.stop_id)
                .map(st => {
                    const trip = trips.find(t => t.trip_id === st.trip_id);
                    // FILTRO 1: ¿Circula hoy?
                    if (!trip || !serviciosActivos.includes(trip.service_id)) return null;

                    const route = routes.find(r => r.route_id === trip.route_id);
                    if (!route) return null;

                    const [h, m, s] = st.departure_time.split(':').map(Number);
                    const horaBusEnMinutos = h * 60 + m;

                    // FILTRO 2: ¿Ya ha pasado? (Margen de 2 minutos por si acaso)
                    if (horaBusEnMinutos < horaActualEnMinutos - 2) return null;

                    return {
                        linea: route.route_short_name,
                        destino: trip.trip_headsign,
                        hora: st.departure_time.substring(0, 5),
                        diffMin: horaBusEnMinutos - horaActualEnMinutos
                    };
                })
                .filter(h => h !== null)
                .sort((a, b) => a.diffMin - b.diffMin);

            // Eliminar duplicados
            const vistos = new Set();
            const unicos = [];
            horarios.forEach(h => {
                const clave = `${h.linea}-${h.hora}-${normalizar(h.destino)}`;
                if (!vistos.has(clave)) {
                    vistos.add(clave);
                    unicos.push(h);
                }
            });

            let html = `<div style="min-width:200px;"><strong>${stop.stop_name}</strong><hr>`;
            if (unicos.length === 0) {
                html += "No hay más buses para hoy.";
            } else {
                unicos.slice(0, 5).forEach(h => {
                    const tiempoLabel = h.diffMin < 60 
                        ? `<span class="${h.diffMin <= 1 ? 'parpadeo' : ''}">en ${Math.max(0, h.diffMin)} min</span>` 
                        : h.hora;
                    
                    html += `<div style="margin-bottom:8px;">
                        <span style="font-weight:bold; background:#eee; padding:2px 5px; border-radius:3px;">${h.linea}</span> 
                        <span style="font-size:0.85em;">${h.destino}</span>: <strong>${tiempoLabel}</strong>
                    </div>`;
                });
            }
            html += `</div>`;

            L.popup().setLatLng(e.target.getLatLng()).setContent(html).openOn(map);
        });

        clusterGroup.addLayer(marker);
    });

    map.addLayer(clusterGroup);

    // Dibujar rutas
    const shapesMap = shapesArray.reduce((acc, pt) => {
        (acc[pt.shape_id] = acc[pt.shape_id] || []).push(pt);
        return acc;
    }, {});

    Object.keys(shapesMap).forEach(sId => {
        const pts = shapesMap[sId].sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence)
                                  .map(p => [parseFloat(p.shape_pt_lat), parseFloat(p.shape_pt_lon)]);
        const trip = trips.find(t => t.shape_id === sId);
        const route = routes.find(r => r.route_id === trip?.route_id);
        let color = route?.route_color ? `#${route.route_color.replace('#','')}` : '#3388ff';
        L.polyline(pts, { color, weight: 4, opacity: 0.7 }).addTo(map);
    });
}

cargarDatosGTFS();