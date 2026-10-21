# Sky Brawl

Boxeo 3D para 2 jugadores en el navegador, en tercera persona, sobre una plataforma flotante al atardecer.

## Arrancar

```bash
npm install
npm start
```

Abre `http://localhost:3000` en dos pestañas o dispositivos de la misma red (`http://IP-DE-TU-PC:3000`).
Uno pulsa **Crear sala**, el otro escribe el código y pulsa **Unirse**.

## Jugar por internet

Hace falta alojar el servidor en un sitio con Node.js y WebSockets. Opción gratuita: Render.

1. Sube la carpeta a un repositorio de GitHub.
2. En render.com: New → Web Service → elige el repositorio.
3. Build command: `npm install`. Start command: `npm start`.
4. Comparte la URL que te dé Render. El plan gratuito se duerme tras inactividad y tarda ~1 min en despertar.

## Controles

| Acción | Tecla |
|---|---|
| Mover | WASD |
| Saltar | Espacio |
| Golpe izquierdo (rápido) | Clic izquierdo (o J) |
| Golpe derecho | Clic derecho (o K) |
| Golpe fuerte (lento, empuja mucho) | E (o L) |
| Bloquear (mantener) | Q |
| Esquivar | Shift |
| Cámara | Ratón (clic para capturarlo, Esc para soltarlo) |
| Música | M |

## Reglas

- Mejor de 3 rondas, 90 s por ronda, 100 de vida.
- Ronda perdida por KO, por caer de la plataforma o por tener menos vida al acabar el tiempo.
- El bloqueo anula los golpes normales (1 de daño) y reduce el fuerte al 40 %.
- La esquiva da invulnerabilidad durante ~0,2 s.

## Modelos propios (.glb)

Por defecto los personajes se generan por código (estilo cartoon). Para usar un modelo propio,
guarda un `.glb` en `public/models/` con el nombre del personaje en minúsculas:
`tito.glb`, `luna.glb`, `bruno.glb`, `kiko.glb`, `nora.glb`, `rex.glb`.
El modelo debe mirar hacia +Z. Se escala a 2 m de alto y se anima entero (inclinación, avance, caída);
no usa las animaciones internas del archivo.

## Estructura

- `server.js`: servidor HTTP + WebSocket. Simulación autoritativa a 60 Hz, estado a 30 Hz.
- `public/game.js`: cliente (entrada, red, cámara, HUD).
- `public/fighter.js`: personajes y poses. `public/world.js`: escenario. `public/audio.js`: sonido sintetizado.
- `npm test`: prueba de humo con dos clientes simulados (salas, golpes, bloqueo, KO, ring-out, revancha).
