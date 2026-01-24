function parsearCSV(csvText) {
    if (!csvText) return [];
    const lineas = csvText.trim().split(/\r?\n/);
    if (lineas.length <= 1) return [];

    const cabeceras = lineas[0].split(',').map(h => h.trim());
    const datos = [];
    
    for (let i = 1; i < lineas.length; i++) {
        const valores = lineas[i].split(',');
        if (lineas[i].trim() === '' || valores.length !== cabeceras.length) continue;

        const objeto = {};
        for (let j = 0; j < cabeceras.length; j++) {
            objeto[cabeceras[j]] = valores[j] ? valores[j].trim().replace(/^"(.*)"$/, '$1') : '';
        }
        datos.push(objeto);
    }
    return datos;
}

async function cargarDatosGTFS() {
    try {
        const baseURL = 'gtfs/';
        const ext = '.txt';

        const [routesTxt, tripsTxt, stopsTxt, stopTimesTxt, shapesTxt] = await Promise.all([
            fetch(baseURL + 'routes' + ext).then(r => r.text()), 
            fetch(baseURL + 'trips' + ext).then(r => r.text()),
            fetch(baseURL + 'stops' + ext).then(r => r.text()),
            fetch(baseURL + 'stop_times' + ext).then(r => r.text()),
            fetch(baseURL + 'shapes' + ext).then(r => r.text())
        ]);
        
        const routes = parsearCSV(routesTxt);
        const trips = parsearCSV(tripsTxt);
        const stops = parsearCSV(stopsTxt);
        const stopTimes = parsearCSV(stopTimesTxt);
        const shapesArray = parsearCSV(shapesTxt); 

        iniciarMapa(stops, stopTimes, trips, routes, shapesArray);

    } catch (e) {
        console.error("Error cargando GTFS:", e);
    }
}

function iniciarMapa(stops, stopTimes, trips, routes, shapesArray) {
    const map = L.map('map').setView([39.9864, -0.0513], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

    const busDivIcon = L.divIcon({
        html: `<div style="background:#0078A8; border-radius:50%; width:25px; height:25px; display:flex; justify-content:center; align-items:center; color:white; font-size:14px; border:2px solid white;">🚌</div>`,
        className: '',
        iconSize: [25, 25],
        iconAnchor: [12, 12]
    });

    const clusterGroup = L.markerClusterGroup();

    stops.forEach(stop => {
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        if (isNaN(lat) || isNaN(lon)) return; 
        
        const marker = L.marker([lat, lon], { icon: busDivIcon });
        marker.bindPopup("Cargando...");

        marker.on('click', () => {
            const ahora = new Date();

            let horariosRaw = stopTimes
                .filter(st => st.stop_id === stop.stop_id)
                .map(st => {
                    const trip = trips.find(t => t.trip_id === st.trip_id);
                    if (!trip) return null;
                    const ruta = routes.find(r => r.route_id === trip.route_id);
                    if (!ruta) return null;

                    const [hh, mm, ss] = st.departure_time.split(':').map(Number);
                    const fechaSalida = new Date(ahora);
                    fechaSalida.setHours(hh, mm, ss, 0);
                    
                    let diffMin = (fechaSalida - ahora) / 60000;
                    if (diffMin < -120) diffMin += 1440; 

                    return {
                        linea: ruta.route_short_name || 'Bus',
                        direccion: trip.trip_headsign || 'Sin dirección',
                        hora: st.departure_time.substring(0, 5), // Solo HH:MM
                        diffMin: diffMin
                    };
                })
                .filter(h => h !== null && h.diffMin >= -1)
                .sort((a, b) => a.diffMin - b.diffMin);

            // --- LÓGICA PARA ELIMINAR DUPLICADOS ---
            const vistos = new Set();
            const horariosUnicos = [];

            for (const h of horariosRaw) {
                // Creamos una clave única: "L1-UJI-12:30"
                const clave = `${h.linea}-${h.direccion}-${h.hora}`;
                if (!vistos.has(clave)) {
                    vistos.add(clave);
                    horariosUnicos.push(h);
                }
            }

            if (horariosUnicos.length === 0) {
                marker.setPopupContent(`<strong>${stop.stop_name}</strong><br>No hay más servicios.`);
                return;
            }

            let html = `<strong>${stop.stop_name}</strong><ul class="popup-list">`;
            
            horariosUnicos.slice(0, 5).forEach(h => {
                let tiempoTexto = "";
                if (h.diffMin < 60) {
                    const min = Math.round(h.diffMin);
                    const clase = min <= 1 ? 'class="parpadeo"' : '';
                    tiempoTexto = `<span ${clase}>en ${min < 0 ? 0 : min} min</span>`;
                } else {
                    tiempoTexto = h.hora; 
                }
                html += `<li><span class="line-badge">${h.linea}</span> ${h.direccion}<br>${tiempoTexto}</li>`;
            });

            html += '</ul>';
            marker.setPopupContent(html);
        });

        clusterGroup.addLayer(marker);
    });

    map.addLayer(clusterGroup);

    // Dibujo de rutas
    const shapesMap = shapesArray.reduce((acc, pt) => {
        acc[pt.shape_id] = acc[pt.shape_id] || [];
        acc[pt.shape_id].push(pt);
        return acc;
    }, {});
    
    for (const shapeId in shapesMap) {
        const puntos = shapesMap[shapeId].sort((a, b) => parseInt(a.shape_pt_sequence) - parseInt(b.shape_pt_sequence));
        const latlngs = puntos.map(pt => [parseFloat(pt.shape_pt_lat), parseFloat(pt.shape_pt_lon)]);
        const tripEj = trips.find(t => t.shape_id === shapeId);
        let colorRuta = '#3388ff';
        if (tripEj) {
            const ruta = routes.find(r => r.route_id === tripEj.route_id);
            if (ruta && ruta.route_color) colorRuta = '#' + ruta.route_color.replace('#','');
        }
        if (latlngs.length > 0) {
             L.polyline(latlngs, { color: colorRuta, weight: 4, opacity: 0.7 }).addTo(map);
        }
    }
}

cargarDatosGTFS();