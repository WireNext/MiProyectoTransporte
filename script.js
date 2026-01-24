/**
 * Normaliza nombres para evitar duplicados visuales por erratas en el GTFS
 */
const normalizar = (t) => t ? t.toLowerCase().replace(/[-]/g, ' ').trim() : '';

/**
 * Parsea el CSV manejando posibles espacios
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
 * Detecta qué service_id (01, 02, etc.) están activos HOY
 */
function obtenerServiciosActivos(calendar) {
    const diasSemana = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const hoy = new Date();
    const nombreDiaHoy = diasSemana[hoy.getDay()];
    const fechaActual = hoy.toISOString().slice(0, 10).replace(/-/g, ''); // Formato YYYYMMDD

    return calendar.filter(s => {
        const dInicio = s.start_date;
        const dFin = s.end_date;
        const circulaHoy = s[nombreDiaHoy] === '1';
        return fechaActual >= dInicio && fechaActual <= dFin && circulaHoy;
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
            
            const horarios = stopTimes
                .filter(st => st.stop_id === stop.stop_id)
                .map(st => {
                    const trip = trips.find(t => t.trip_id === st.trip_id);
                    // FILTRO DE CALENDARIO: Solo procesar si el service_id está activo hoy
                    if (!trip || !serviciosActivos.includes(trip.service_id)) return null;

                    const route = routes.find(r => r.route_id === trip.route_id);
                    if (!route) return null;

                    const [h, m, s] = st.departure_time.split(':').map(Number);
                    const dSalida = new Date(ahora);
                    dSalida.setHours(h, m, s, 0);
                    
                    let diff = (dSalida - ahora) / 60000;
                    if (diff < -120) diff += 1440; // Corrección para horarios nocturnos

                    return {
                        linea: route.route_short_name,
                        destino: trip.trip_headsign,
                        hora: st.departure_time.substring(0, 5),
                        diffMin: Math.round(diff)
                    };
                })
                .filter(h => h !== null && h.diffMin >= -1)
                .sort((a, b) => a.diffMin - b.diffMin);

            // Eliminar duplicados técnicos (misma línea/hora/destino)
            const vistos = new Set();
            const unicos = [];
            horarios.forEach(h => {
                const clave = `${h.linea}-${h.hora}-${normalizar(h.destino)}`;
                if (!vistos.has(clave)) {
                    vistos.add(clave);
                    unicos.push(h);
                }
            });

            let html = `<div style="min-width:180px;"><strong>${stop.stop_name}</strong><hr>`;
            if (unicos.length === 0) {
                html += "No hay buses programados para hoy.";
            } else {
                unicos.slice(0, 5).forEach(h => {
                    const tiempo = h.diffMin < 60 
                        ? `<span class="${h.diffMin <= 1 ? 'parpadeo' : ''}">en ${Math.max(0, h.diffMin)} min</span>` 
                        : h.hora;
                    
                    html += `<div style="margin-bottom:6px;">
                        <span style="font-weight:bold; background:#eee; padding:2px 4px; border-radius:3px;">${h.linea}</span> 
                        <span style="font-size:0.85em; color:#555;">${h.destino}</span>: <strong>${tiempo}</strong>
                    </div>`;
                });
            }
            html += `</div>`;

            L.popup().setLatLng(e.target.getLatLng()).setContent(html).openOn(map);
        });

        clusterGroup.addLayer(marker);
    });

    map.addLayer(clusterGroup);

    // Dibujar shapes con los colores de routes.txt
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