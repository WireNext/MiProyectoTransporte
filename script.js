/**
 * @function parsearCSV
 * Convierte texto CSV a Array de Objetos.
 */
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
            // Limpiar comillas y espacios
            objeto[cabeceras[j]] = valores[j] ? valores[j].trim().replace(/^"(.*)"$/, '$1') : '';
        }
        datos.push(objeto);
    }
    return datos;
}

/**
 * @function cargarDatosGTFS
 * Carga y procesa los archivos .txt de la carpeta gtfs/
 */
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

        console.log("✅ Datos GTFS cargados con éxito.");
        iniciarMapa(stops, stopTimes, trips, routes, shapesArray);

    } catch (e) {
        console.error("❌ Error al cargar GTFS:", e);
        alert("Error cargando los datos. Revisa la consola para más detalles.");
    }
}

function iniciarMapa(stops, stopTimes, trips, routes, shapesArray) {
    // Coordenadas centradas por defecto (Castellón)
    const map = L.map('map').setView([39.9864, -0.0513], 14);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const busDivIcon = L.divIcon({
        html: `<div style="background:#0078A8; border-radius:50%; width:25px; height:25px; display:flex; justify-content:center; align-items:center; color:white; font-size:14px; border:2px solid white;">🚌</div>`,
        className: '',
        iconSize: [25, 25],
        iconAnchor: [12, 12]
    });

    const clusterGroup = L.markerClusterGroup();

    // 1. PROCESAR PARADAS
    stops.forEach(stop => {
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        if (isNaN(lat) || isNaN(lon)) return; 
        
        const marker = L.marker([lat, lon], { icon: busDivIcon });
        marker.bindPopup("Cargando horarios...");

        marker.on('click', () => {
            const ahora = new Date();

            const horarios = stopTimes
                .filter(st => st.stop_id === stop.stop_id)
                .map(st => {
                    const trip = trips.find(t => t.trip_id === st.trip_id);
                    if (!trip) return null;

                    const ruta = routes.find(r => r.route_id === trip.route_id);
                    if (!ruta) return null;

                    // Parsear hora de salida
                    const [hh, mm, ss] = st.departure_time.split(':').map(Number);
                    const fechaSalida = new Date(ahora);
                    fechaSalida.setHours(hh, mm, ss, 0);
                    
                    let diffMin = (fechaSalida - ahora) / 60000;
                    if (diffMin < -120) diffMin += 1440; // Ajuste para servicios de madrugada

                    return {
                        linea: ruta.route_short_name || 'Bus',
                        direccion: trip.trip_headsign || 'Sin dirección',
                        hora: st.departure_time,
                        diffMin
                    };
                })
                .filter(h => h !== null && h.diffMin >= -1) // Solo servicios futuros o en curso
                .sort((a, b) => a.diffMin - b.diffMin);

            if (horarios.length === 0) {
                marker.setPopupContent(`<strong>${stop.stop_name}</strong><br>No hay más servicios hoy.`);
                return;
            }

            let html = `<strong>${stop.stop_name}</strong><ul class="popup-list">`;
            
            // Mostrar los próximos 5 servicios
            horarios.slice(0, 5).forEach(h => {
                let tiempoTexto = "";
                
                // REGLA: Menos de 60 min -> "en X min". Más de 60 min -> "HH:MM"
                if (h.diffMin < 60) {
                    const min = Math.round(h.diffMin);
                    const clase = min <= 1 ? 'class="parpadeo"' : '';
                    tiempoTexto = `<span ${clase}>en ${min < 0 ? 0 : min} min</span>`;
                } else {
                    tiempoTexto = h.hora.substring(0, 5); 
                }

                html += `<li><b>${h.linea}</b> ${h.direccion}: ${tiempoTexto}</li>`;
            });

            html += '</ul>';
            marker.setPopupContent(html);
        });

        clusterGroup.addLayer(marker);
    });

    map.addLayer(clusterGroup);

    // 2. DIBUJAR SHAPES (Rutas con color dinámico)
    const shapesMap = shapesArray.reduce((acc, pt) => {
        acc[pt.shape_id] = acc[pt.shape_id] || [];
        acc[pt.shape_id].push(pt);
        return acc;
    }, {});
    
    for (const shapeId in shapesMap) {
        const puntos = shapesMap[shapeId].sort((a, b) => parseInt(a.shape_pt_sequence) - parseInt(b.shape_pt_sequence));
        const latlngs = puntos.map(pt => [parseFloat(pt.shape_pt_lat), parseFloat(pt.shape_pt_lon)]);

        // Buscar color de la ruta
        const tripEjemplo = trips.find(t => t.shape_id === shapeId);
        let colorRuta = '#3388ff'; // Azul estándar de Leaflet por defecto

        if (tripEjemplo) {
            const ruta = routes.find(r => r.route_id === tripEjemplo.route_id);
            if (ruta && ruta.route_color) {
                colorRuta = ruta.route_color.startsWith('#') ? ruta.route_color : '#' + ruta.route_color;
            }
        }

        if (latlngs.length > 0) {
             L.polyline(latlngs, {
                color: colorRuta,
                weight: 4,
                opacity: 0.8
            }).addTo(map);
        }
    }
}

// Ejecutar
cargarDatosGTFS();