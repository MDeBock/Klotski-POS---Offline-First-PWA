#  Klotski POS - Offline-First PWA (Mobile Edition)

Un Producto Mínimo Viable (MVP) de un sistema de Punto de Venta (POS) diseñado para operar en entornos minoristas (kioscos, verdulerías, minimarkets) con alta demanda de velocidad y sin dependencia de una conexión a internet. 

 **ADVERTENCIA DE DISEÑO (Mobile-Only):** La interfaz de usuario (UI) de este proyecto fue construida milimétricamente para ser operada desde un teléfono celular (formato vertical), optimizando el espacio del mostrador. **No está pensada para monitores de escritorio.** Si abres este proyecto en una PC, te recomendamos encarecidamente usar las herramientas de desarrollador de tu navegador (F12 > Toggle Device Toolbar) para visualizarla correctamente en modo móvil.

Este proyecto demuestra una arquitectura **100% Frontend (Serverless)**, utilizando el almacenamiento local del navegador para mantener la persistencia de datos y criptografía avanzada para la seguridad de la información.

> **Roadmap y Arquitectura:** Este repositorio contiene la **Fase 1 (Capa Cliente Offline)** del proyecto. Actualmente, el sistema se encuentra validando operaciones en comercios reales, sirviendo como base para la **Fase 2**, donde se está desarrollando la API y la arquitectura central del servidor utilizando **Python y Django** para la sincronización de múltiples sucursales en la nube.

##  Funcionalidades Principales

* ** Escáner de Código de Barras Nativo:** Utiliza la cámara del dispositivo para identificar productos rápidamente.
* ** Smart Scan (Unidad vs Granel):** Lógica inteligente que diferencia productos unitarios de aquellos pesables (ej. frutas), desplegando calculadoras de cantidad dinámicamente.
* ** Pagos Múltiples (Split Payments):** Permite cobrar un mismo ticket dividiendo el monto entre Efectivo, Transferencia y Fiado, manteniendo la contabilidad exacta en la caja.
* ** Gestión de Cuentas Corrientes (Fiados):** Módulo completo para registrar, rastrear y saldar deudas de clientes habituales, inyectando los pagos parciales directamente en la caja del turno.
* ** Seguridad y Backups Encriptados:** Sistema de PIN maestro autogenerado en el primer uso (First-Time Setup). Los backups de la base de datos se exportan sellados con encriptación AES-256 para evitar fugas de datos.
* ** Exportación de Reportes:** Generación nativa de archivos `.csv` para auditorías de inventario y ventas en Excel.

##  Stack Tecnológico

* **Frontend:** HTML5, CSS3, JavaScript Vanilla (ES6+).
* **Estilos:** Tailwind CSS (Mobile-First approach).
* **Almacenamiento Local:** [LocalForage](https://localforage.github.io/localForage/) (Wrapper asíncrono sobre IndexedDB).
* **Lectura de Códigos:** [Html5-QRCode](https://github.com/mebjas/html5-qrcode).
* **Criptografía:** [CryptoJS](https://cryptojs.gitbook.io/docs/) (AES Encryption).

##  Instalación y Uso

Al ser una arquitectura pura de Frontend, no requiere de Node.js, npm, ni configuración de servidores.

1. Clona este repositorio: `git clone https://github.com/MDeBock/klotski-pos.git`
2. Abre el archivo `index.html` en tu navegador y simula la vista de dispositivo móvil.
3. Para la experiencia completa, el proyecto esta desplegado en https://vtascan.netlify.app/ , puedes abrirla directamente desde tu smartphone.
