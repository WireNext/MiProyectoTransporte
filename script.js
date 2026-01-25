const normalizar = (t) => t ? t.toLowerCase().replace(/[-]/g, ' ').trim() : '';

function parsearCSV(csvText) {
    if (!csvText) return [];
    const lineas = csvText.trim().split(/\r?\n/);
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

function obtenerServiciosActivos(calendar) {
    const diasSemana = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const ahora = new Date();
    const nombreDiaHoy = diasSemana[ahora.getDay()];
    const fechaActual = ahora.toISOString().slice(0, 10).replace(/-/g, '');
    return calendar.filter(s => s[nombreDiaHoy] === '1' && fechaActual >= s.start_date && fechaActual <= s.end_date).map(s => s.service_id);
}

async function cargarDatosGTFS() {
    try {
        let incidencias = { viajes_cancelados: [], paradas_omitidas: [], avisos_paradas: {} };
        try {
            const resp = await fetch('incidencias.json');
            if (resp.ok) incidencias = await resp.json();
        } catch (e) { console.warn("No se cargaron incidencias."); }

        const [routes, trips, stops, stopTimes, shapes, calendar] = await Promise.all([
            fetch('gtfs/routes.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/trips.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/stops.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/stop_times.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/shapes.txt').then(r => r.text()).then(parsearCSV),
            fetch('gtfs/calendar.txt').then(r => r.text()).then(parsearCSV)
        ]);

        const serviciosActivos = obtenerServiciosActivos(calendar);
        iniciarMapa(stops, stopTimes, trips, routes, shapes, serviciosActivos, incidencias);
    } catch (e) { console.error("Error:", e); }
}

function iniciarMapa(stops, stopTimes, trips, routes, shapesArray, serviciosActivos, incidencias) {
    const map = L.map('map').setView([39.9864, -0.0513], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    const clusterGroup = L.markerClusterGroup();
    const busIcon = L.divIcon({
        html: `<div style="background:#0078A8; border-radius:50%; width:24px; height:24px; border:2px solid white; display:flex; justify-content:center; align-items:center; color:white; font-size:12px;">🚌</div>`,
        className: '', iconSize: [24, 24]
    });

    stops.forEach(stop => {
        const marker = L.marker([parseFloat(stop.stop_lat), parseFloat(stop.stop_lon)], { icon: busIcon });

        marker.on('click', function(e) {
            const ahora = new Date();
            const horaActualMin = ahora.getHours() * 60 + ahora.getMinutes();

            const horarios = stopTimes
                .filter(st => st.stop_id === stop.stop_id)
                .map(st => {
                    const trip = trips.find(t => t.trip_id === st.trip_id);
                    if (!trip || !serviciosActivos.includes(trip.service_id)) return null;

                    const route = routes.find(r => r.route_id === trip.route_id);
                    const [h, m] = st.departure_time.split(':').map(Number);
                    const horaBusMin = h * 60 + m;
                    if (horaBusMin < horaActualMin - 2) return null;

                    const horaCorta = st.departure_time.substring(0, 5);
                    const canceladoTotal = incidencias.viajes_cancelados?.find(v => v.trip_id === trip.trip_id && (v.hora === horaCorta || v.hora === "all"));
                    const paradaOmitida = incidencias.paradas_omitidas?.find(v => v.trip_id === trip.trip_id && (v.stop_id === stop.stop_id || v.stop_id === "all"));

                    return {
                        linea: route.route_short_name,
                        destino: trip.trip_headsign,
                        hora: horaCorta,
                        diffMin: horaBusMin - horaActualMin,
                        incidencia: canceladoTotal || paradaOmitida,
                        // GUARDAMOS COLORES DE LA RUTA
                        colorFondo: route.route_color ? `#${route.route_color.replace('#','')}` : '#eee',
                        colorTexto: route.route_text_color ? `#${route.route_text_color.replace('#','')}` : '#000'
                    };
                })
                .filter(h => h !== null)
                .sort((a, b) => a.diffMin - b.diffMin);

            const vistos = new Set();
            const unicos = [];
            horarios.forEach(h => {
                const clave = `${h.linea}-${h.hora}-${normalizar(h.destino)}`;
                if (!vistos.has(clave)) { vistos.add(clave); unicos.push(h); }
            });

            let html = `<div style="min-width:220px;"><strong>${stop.stop_name}</strong><br>`;
            if (incidencias.avisos_paradas[stop.stop_id]) {
                html += `<div style="background:#fff3cd; color:#856404; padding:5px; border-radius:4px; font-size:0.8em; margin:5px 0; border:1px solid #ffeeba;">⚠️ ${incidencias.avisos_paradas[stop.stop_id]}</div>`;
            }
            html += `<hr>`;

            if (unicos.length === 0) {
                html += "Sin servicios próximos.";
            } else {
                unicos.slice(0, 5).forEach(h => {
                    const esMalaNoticia = h.incidencia;
                    const tiempoLabel = (h.diffMin < 60 && !esMalaNoticia) ? `en ${Math.max(0, h.diffMin)} min` : h.hora;
                    const estiloHora = esMalaNoticia ? "text-decoration: line-through; color: red;" : "font-weight:bold;";

                    html += `<div style="margin-bottom:8px;">
                        <span style="font-weight:bold; background:${h.colorFondo}; color:${h.colorTexto}; padding:2px 6px; border-radius:3px; display:inline-block; min-width:25px; text-align:center;">${h.linea}</span> 
                        <span style="font-size:0.85em; margin-left:4px;">${h.destino}</span>: <strong style="${estiloHora}">${tiempoLabel}</strong>
                        ${esMalaNoticia ? `<br><span style="color:red; font-size:0.75em;">🚫 ${h.incidencia.motivo}</span>` : ''}
                    </div>`;
                });
            }
            html += `</div>`;
            L.popup().setLatLng(e.target.getLatLng()).setContent(html).openOn(map);
        });
        clusterGroup.addLayer(marker);
    });
    map.addLayer(clusterGroup);

    // Shapes (Líneas en el mapa)
    const shapesMap = shapesArray.reduce((acc, pt) => {
        (acc[pt.shape_id] = acc[pt.shape_id] || []).push(pt);
        return acc;
    }, {});
    Object.keys(shapesMap).forEach(sId => {
        const pts = shapesMap[sId].sort((a, b) => a.shape_pt_sequence - b.shape_pt_sequence).map(p => [parseFloat(p.shape_pt_lat), parseFloat(p.shape_pt_lon)]);
        const trip = trips.find(t => t.shape_id === sId);
        const route = routes.find(r => r.route_id === trip?.route_id);
        let color = route?.route_color ? `#${route.route_color.replace('#','')}` : '#3388ff';
        L.polyline(pts, { color, weight: 4, opacity: 0.7 }).addTo(map);
    });
}

cargarDatosGTFS();