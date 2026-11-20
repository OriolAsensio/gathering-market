"use strict";
/* Idiomas de la app: español (el original), inglés y catalán.
 * La app se escribe en español; esto traduce lo que aparece en pantalla al vuelo (texto,
 * placeholders, títulos), también lo que genera el motor (motivos, avisos, guía del mazo).
 *  - EXACT: frases completas  [español, inglés, catalán]
 *  - RULES: frases con datos (nombres, números): expresión regular + traducción con $1, $2…
 * Para añadir un texto: añade una fila. Si falta una traducción, se queda en español.
 */
const LANGS = { es: "Español", en: "English", ca: "Català" };
const LANG = (() => {
  try { const s = localStorage.getItem("lang"); if (LANGS[s]) return s; } catch { /* sin almacenamiento */ }
  const nav = (navigator.language || "es").slice(0, 2);
  return nav === "ca" ? "ca" : nav === "es" ? "es" : "en";
})();

const EXACT = [
  // Pestañas, cabecera y botones generales
  ["Cartas", "Cards", "Cartes"], ["Colecciones", "Collections", "Col·leccions"], ["Mazos", "Decks", "Baralles"],
  ["Mercado", "Market", "Mercat"], ["Avisos", "Alerts", "Avisos"], ["Mis cartas", "My cards", "Les meves cartes"],
  ["📥 Importar", "📥 Import", "📥 Importar"], ["🔨 Crear mazo", "🔨 Build deck", "🔨 Crear baralla"], ["Crear mazo", "Build deck", "Crear baralla"],
  ["🖼 Imágenes", "🖼 Images", "🖼 Imatges"], ["☰ Lista", "☰ List", "☰ Llista"], ["☑ Seleccionar", "☑ Select", "☑ Seleccionar"],
  ["Imágenes", "Images", "Imatges"], ["Lista", "List", "Llista"], ["Cancelar", "Cancel", "Cancel·lar"], ["Importar", "Import", "Importar"],
  ["Importando…", "Importing…", "Important…"], ["Crear", "Create", "Crear"], ["Cerrar", "Close", "Tancar"], ["Añadir", "Add", "Afegir"],
  ["Copiar lista", "Copy list", "Copiar llista"], ["Copiar lo que falta", "Copy what's missing", "Copiar el que falta"],
  ["Compartir lo que falta", "Share what's missing", "Compartir el que falta"], ["Nada.", "Nothing.", "Res."],
  ["Reintentar", "Retry", "Tornar-ho a provar"], ["Sí", "Yes", "Sí"], ["No", "No", "No"], ["Ban", "Ban", "Ban"],
  ["Foil", "Foil", "Foil"], ["Total", "Total", "Total"], ["Copias", "Copies", "Còpies"], ["Precio unidad", "Unit price", "Preu unitat"],
  ["Legal Pauper", "Pauper legal", "Legal Pauper"], ["Escanear carta con la cámara", "Scan a card with the camera", "Escanejar carta amb la càmera"],
  ["Cambiar de carpeta", "Switch binder", "Canviar de carpeta"], ["Abriendo el códice…", "Opening the codex…", "Obrint el còdex…"],
  ["Abriendo el códice de cartas…", "Opening the card codex…", "Obrint el còdex de cartes…"],
  ["Descargando el códice de cartas…", "Downloading the card codex…", "Descarregant el còdex de cartes…"],
  ["Consultando a los mercaderes…", "Asking the merchants…", "Consultant els mercaders…"],
  ["No he podido abrir los datos", "I couldn't open the data", "No he pogut obrir les dades"],
  ["Sin conexión: usando los últimos precios guardados", "Offline: using the last saved prices", "Sense connexió: fent servir els últims preus desats"],
  ["Hace falta conexión a internet la primera vez para descargar las cartas.", "An internet connection is needed the first time to download the cards.", "Cal connexió a internet la primera vegada per descarregar les cartes."],

  // Carpetas e importar
  ["Carpetas", "Binders", "Carpetes"], ["Nueva carpeta", "New binder", "Nova carpeta"], ["Ej.: Cartas de Marc", "E.g.: Marc's cards", "Ex.: Cartes d'en Marc"],
  ["Cada carpeta es un montón de cartas: las tuyas y, por ejemplo, las de un amigo para montarle mazos. Solo \"Mis cartas\" envía avisos de precio.",
    "Each binder is a pile of cards: yours and, for example, a friend's to build decks for them. Only \"My cards\" sends price alerts.",
    "Cada carpeta és un munt de cartes: les teves i, per exemple, les d'un amic per muntar-li baralles. Només \"Les meves cartes\" envia avisos de preu."],
  ["Ya existe una con ese nombre", "There's already one with that name", "Ja n'hi ha una amb aquest nom"],
  ["Importar cartas", "Import cards", "Importar cartes"], ["📄 Elegir archivo (.csv o .txt)", "📄 Choose file (.csv or .txt)", "📄 Triar fitxer (.csv o .txt)"],
  ["O pega aquí la lista", "Or paste the list here", "O enganxa aquí la llista"], ["Sumar a lo que hay", "Add to what's there", "Sumar al que hi ha"],
  ["Reemplazar la carpeta", "Replace the binder", "Substituir la carpeta"], ["Elige un archivo o pega una lista", "Choose a file or paste a list", "Tria un fitxer o enganxa una llista"],
  ["Se borrarán las cartas que hay ahora en esta carpeta. ¿Seguir?", "The cards currently in this binder will be deleted. Continue?", "S'esborraran les cartes que hi ha ara en aquesta carpeta. Continuar?"],
  ["Cartas importadas", "Cards imported", "Cartes importades"], ["Distintas", "Unique", "Diferents"], ["No encontradas", "Not found", "No trobades"],
  ["No he encontrado:", "Not found:", "No he trobat:"], ["El archivo está vacío o no lo entiendo", "The file is empty or I can't read it", "El fitxer és buit o no l'entenc"],
  ["Exporta tus cartas como", "Export your cards as", "Exporta les teves cartes com a"],
  ["desde ManaBox (opción de exportar), Moxfield, Deckbox o Dragon Shield, y elige el archivo aquí. También vale una lista de texto tipo",
    "from ManaBox (export option), Moxfield, Deckbox or Dragon Shield, and choose the file here. A text list also works, like",
    "des de ManaBox (opció d'exportar), Moxfield, Deckbox o Dragon Shield, i tria el fitxer aquí. També val una llista de text com"],

  // Cartas
  ["Filtrar o buscar carta para añadir…", "Filter, or search a card to add…", "Filtrar o cercar carta per afegir…"],
  ["Esta carpeta está vacía", "This binder is empty", "Aquesta carpeta és buida"],
  ["Pulsa el sello rojo para escanear cartas, escribe su nombre arriba o importa un CSV de ManaBox.", "Tap the red seal to scan cards, type their name above or import a ManaBox CSV.", "Prem el segell vermell per escanejar cartes, escriu el nom a dalt o importa un CSV de ManaBox."],
  ["Mantén pulsada una carta para elegir varias y crear un mazo con ellas.", "Long-press a card to pick several and build a deck with them.", "Mantén premuda una carta per triar-ne diverses i crear una baralla amb elles."],
  ["Añadir a la carpeta", "Add to binder", "Afegir a la carpeta"], ["No hay cartas con ese nombre.", "No cards with that name.", "No hi ha cartes amb aquest nom."],
  ["La juegan en Pauper", "Played in Pauper", "Es juga a Pauper"], ["🛒 Ver en Cardmarket", "🛒 See on Cardmarket", "🛒 Veure a Cardmarket"],
  ["🔮 Cartas que combinan con esta", "🔮 Cards that combo with this", "🔮 Cartes que combinen amb aquesta"],
  ["Quitar una", "Remove one", "Treure'n una"], ["Añadir otra", "Add another", "Afegir-ne una altra"], ["Añadida", "Added", "Afegida"], ["Quitada", "Removed", "Treta"],
  ["Añadir carta", "Add card", "Afegir carta"], ["¿Cuál es? Toca la correcta:", "Which one is it? Tap the right one:", "Quina és? Toca la correcta:"],
  ["No es esta", "Not this one", "No és aquesta"], ["desde", "from", "des de"], ["Pauper", "Pauper", "Pauper"],
  ["Baneada", "Banned", "Prohibida"], ["Baneada en Pauper", "Banned in Pauper", "Prohibida a Pauper"], ["La tienes", "You have it", "La tens"],

  // Colecciones
  ["Cada vez que registras una carta, su colección aparece aquí. Fija las que quieras completar para seguirlas y ver qué te falta.",
    "Every time you register a card, its set shows up here. Pin the ones you want to complete to follow them and see what you're missing.",
    "Cada vegada que registres una carta, la seva col·lecció apareix aquí. Fixa les que vulguis completar per seguir-les i veure què et falta."],
  ["Lista Reservada", "Reserved List", "Llista Reservada"], ["Las cartas que Wizards se ha comprometido a no reimprimir nunca.", "The cards Wizards has promised never to reprint.", "Les cartes que Wizards s'ha compromès a no reimprimir mai."],
  ["Mazos preconstruidos", "Preconstructed decks", "Baralles preconstruïdes"],
  ["Todos los mazos oficiales de la historia: Commander, Theme Decks, Intro Packs, Duel Decks…", "Every official deck in history: Commander, Theme Decks, Intro Packs, Duel Decks…", "Totes les baralles oficials de la història: Commander, Theme Decks, Intro Packs, Duel Decks…"],
  ["Buscar una colección para seguirla…", "Search a set to follow…", "Cercar una col·lecció per seguir-la…"], ["Siguiendo", "Following", "Seguint"], ["Empezadas", "Started", "Començades"],
  ["📌 Siguiendo", "📌 Following", "📌 Seguint"], ["Aún no has empezado ninguna", "You haven't started any yet", "Encara no n'has començat cap"],
  ["Escanea o importa cartas y sus colecciones aparecerán aquí. También puedes buscar una arriba y seguirla.", "Scan or import cards and their sets will show up here. You can also search one above and follow it.", "Escaneja o importa cartes i les seves col·leccions apareixeran aquí. També en pots cercar una a dalt i seguir-la."],
  ["No encuentro ninguna colección con ese nombre.", "I can't find any set with that name.", "No trobo cap col·lecció amb aquest nom."],
  ["📌 Seguir esta colección", "📌 Follow this set", "📌 Seguir aquesta col·lecció"], ["Dejar de seguir", "Unfollow", "Deixar de seguir"], ["Ya no la sigues", "Unfollowed", "Ja no la segueixes"],
  ["Lo que tienes vale", "What you own is worth", "El que tens val"], ["Completarla cuesta", "Completing it costs", "Completar-la costa"],
  ["Colección base", "Base set", "Col·lecció base"], ["Todas las versiones", "All versions", "Totes les versions"], ["Todas", "All", "Totes"], ["Las tengo", "I have them", "Les tinc"],
  ["Cualquier rareza", "Any rarity", "Qualsevol raresa"], ["Común", "Common", "Comuna"], ["Infrecuente", "Uncommon", "Infreqüent"], ["Rara", "Rare", "Rara"], ["Mítica", "Mythic", "Mítica"],
  ["Vale cualquier edición de cada carta.", "Any printing of each card counts.", "Val qualsevol edició de cada carta."],
  ["Incluye promos, versiones sin borde, showcase…", "Includes promos, borderless, showcase versions…", "Inclou promos, versions sense vora, showcase…"],
  ["Cartas normales de la colección; vale cualquier versión de la misma edición.", "Regular cards of the set; any version from the same set counts.", "Cartes normals de la col·lecció; val qualsevol versió de la mateixa edició."],
  ["Toca una carta para añadirla.", "Tap a card to add it.", "Toca una carta per afegir-la."], ["Ninguna carta con estos filtros.", "No cards with these filters.", "Cap carta amb aquests filtres."],
  ["☑ Seleccionar varias (o mantén pulsada una carta)", "☑ Select several (or long-press a card)", "☑ Seleccionar-ne diverses (o mantén premuda una carta)"],
  ["✓ Seleccionando… (toca para salir)", "✓ Selecting… (tap to exit)", "✓ Seleccionant… (toca per sortir)"],
  ["Toca las cartas que quieras", "Tap the cards you want", "Toca les cartes que vulguis"], ["Todas las visibles", "All visible", "Totes les visibles"],
  ["Lista de lo que falta copiada", "Missing list copied", "Llista del que falta copiada"], ["Lista copiada", "List copied", "Llista copiada"], ["No se ha podido copiar", "Couldn't copy", "No s'ha pogut copiar"],
  ["No se reimprimen", "Never reprinted", "No es reimprimeixen"],
  ["Busca por nombre, tipo (Commander, Theme Deck…) o colección. Arriba, los que ya tienes empezados.", "Search by name, type (Commander, Theme Deck…) or set. Started ones first.", "Cerca per nom, tipus (Commander, Theme Deck…) o col·lecció. A dalt, les que ja tens començades."],
  ["Ej.: Commander 2016, Elves, Duel Decks…", "E.g.: Commander 2016, Elves, Duel Decks…", "Ex.: Commander 2016, Elves, Duel Decks…"], ["No encuentro ningún mazo así.", "I can't find a deck like that.", "No trobo cap baralla així."],

  // Mazos
  ["Crear un mazo con tus cartas", "Build a deck with your cards", "Crear una baralla amb les teves cartes"],
  ["Pauper, Commander, Estándar o Casual: a partir de una o varias cartas, o de un comandante.", "Pauper, Commander, Standard or Casual: from one or more cards, or a commander.", "Pauper, Commander, Estàndard o Casual: a partir d'una o diverses cartes, o d'un comandant."],
  ["Mis mazos", "My decks", "Les meves baralles"], ["Importa una lista o guarda un mazo (del meta o del constructor) para ver qué cartas te faltan.", "Import a list or save a deck (from the meta or the builder) to see which cards you're missing.", "Importa una llista o desa una baralla (del meta o del constructor) per veure quines cartes et falten."],
  ["📥 Importar una lista", "📥 Import a list", "📥 Importar una llista"], ["Meta de Pauper", "Pauper meta", "Meta de Pauper"],
  ["De cada arquetipo, la lista mejor clasificada (🏆 la ganadora si la hay) de los últimos 2 meses en MTGTop8. \"Weenie White\" es el mono blanco (Convoke, Kor Skyfisher…).",
    "For each archetype, the best-placed list (🏆 the winner if there is one) from the last 2 months on MTGTop8. \"Weenie White\" is mono-white (Convoke, Kor Skyfisher…).",
    "De cada arquetip, la llista millor classificada (🏆 la guanyadora si n'hi ha) dels últims 2 mesos a MTGTop8. \"Weenie White\" és el mono blanc (Convoke, Kor Skyfisher…)."],
  ["Más jugados", "Most played", "Més jugades"], ["Puedo montar", "I can build", "Puc muntar"], ["Más baratos", "Cheapest", "Més barates"], ["Me falta menos €", "Least € missing", "Em falten menys €"],
  ["Aún no hay datos del meta", "No meta data yet", "Encara no hi ha dades del meta"], ["Se descargan cada día.", "They're downloaded every day.", "Es descarreguen cada dia."],
  ["¡Lo puedes montar!", "You can build it!", "La pots muntar!"], ["Precio del mazo", "Deck price", "Preu de la baralla"], ["Lo tienes", "You own", "La tens"], ["Te falta", "Missing", "Et falta"],
  ["En gris, las cartas que no tienes. El número es copias tuyas / copias del mazo.", "Greyed out: cards you don't have. The number is your copies / deck copies.", "En gris, les cartes que no tens. El número és còpies teves / còpies de la baralla."],
  ["Precio con la edición más barata de cada carta (Cardmarket). Verde: la tienes; amarillo: te faltan copias.", "Price using the cheapest printing of each card (Cardmarket). Green: you have it; yellow: missing copies.", "Preu amb l'edició més barata de cada carta (Cardmarket). Verd: la tens; groc: et falten còpies."],
  ["⭐ Guardar en Mis mazos", "⭐ Save to My decks", "⭐ Desar a Les meves baralles"], ["🗑 Borrar de Mis mazos", "🗑 Remove from My decks", "🗑 Esborrar de Les meves baralles"],
  ["Guardado en Mis mazos", "Saved to My decks", "Desat a Les meves baralles"], ["Mazo borrado", "Deck removed", "Baralla esborrada"], ["básica", "basic", "bàsica"],
  ["Importar una lista", "Import a list", "Importar una llista"], ["Nombre del mazo", "Deck name", "Nom de la baralla"], ["Ej.: Mi Mono White Convoke", "E.g.: My Mono White Convoke", "Ex.: La meva Mono White Convoke"],
  ["📄 O elige un archivo .txt", "📄 Or choose a .txt file", "📄 O tria un fitxer .txt"], ["Guardar en Mis mazos", "Save to My decks", "Desar a Les meves baralles"],
  ["No he reconocido estas líneas:", "I didn't recognise these lines:", "No he reconegut aquestes línies:"], ["Ver el mazo", "See the deck", "Veure la baralla"],
  ["No he reconocido ninguna carta en la lista", "I didn't recognise any card in the list", "No he reconegut cap carta a la llista"],
  ["Pega la lista (de MTGTop8, Moxfield, Arena…): una carta por línea,", "Paste the list (from MTGTop8, Moxfield, Arena…): one card per line,", "Enganxa la llista (de MTGTop8, Moxfield, Arena…): una carta per línia,"],
  [". Lo que vaya tras \"Sideboard\" cuenta como banquillo.", ". Anything after \"Sideboard\" counts as sideboard.", ". El que vagi després de \"Sideboard\" compta com a banqueta."],
  ["Mi mazo", "My deck", "La meva baralla"],

  // Constructor
  ["¿Con qué cartas empezamos?", "Which cards do we start with?", "Amb quines cartes comencem?"],
  ["Toca una o varias cartas que te gusten: la app buscará otras que hagan combo con ellas. Para Commander, elige una criatura legendaria.",
    "Tap one or more cards you like: the app will look for others that combo with them. For Commander, pick a legendary creature.",
    "Toca una o diverses cartes que t'agradin: l'app en buscarà d'altres que facin combo amb elles. Per a Commander, tria una criatura llegendària."],
  ["Buscar en tus cartas…", "Search your cards…", "Cercar a les teves cartes…"], ["👑 Solo comandantes", "👑 Commanders only", "👑 Només comandants"],
  ["Ninguna elegida", "None picked", "Cap triada"], ["👑 Commander", "👑 Commander", "👑 Commander"], ["No hay ninguna carta así.", "No card like that.", "No hi ha cap carta així."],
  ["No hay cartas en esta carpeta", "No cards in this binder", "No hi ha cartes en aquesta carpeta"], ["Importa un CSV o escanea cartas primero.", "Import a CSV or scan cards first.", "Importa un CSV o escaneja cartes primer."],
  ["Buscando cartas que encajen con el plan…", "Looking for cards that fit the plan…", "Buscant cartes que encaixin amb el pla…"], ["No he podido montarlo", "I couldn't build it", "No l'he pogut muntar"],
  ["Commander", "Commander", "Commander"], ["Estándar", "Standard", "Estàndard"], ["Casual", "Casual", "Casual"], ["Comandante", "Commander", "Comandant"],
  ["Tierras", "Lands", "Terres"], ["Valor", "Value", "Valor"], ["Criaturas", "Creatures", "Criatures"], ["Hechizos", "Spells", "Encanteris"],
  ["Plan del mazo:", "Deck plan:", "Pla de la baralla:"], ["Funciones:", "Roles:", "Funcions:"], ["📖 Cómo se juega este mazo", "📖 How to play this deck", "📖 Com es juga aquesta baralla"],
  ["Cartas clave:", "Key cards:", "Cartes clau:"], ["El plan:", "The plan:", "El pla:"], ["Combos que funcionan juntos:", "Combos that work together:", "Combos que funcionen junts:"],
  ["Turno a turno:", "Turn by turn:", "Torn a torn:"], ["Mulligan:", "Mulligan:", "Mulligan:"], ["También encajarían", "These would also fit", "També hi encaixarien"],
  ["Otras cartas", "Other cards", "Altres cartes"], ["💾 Guardar en Mis mazos", "💾 Save to My decks", "💾 Desar a Les meves baralles"],
  ["El mazo necesita al menos un color", "The deck needs at least one colour", "La baralla necessita almenys un color"], ["Elige al menos una carta", "Pick at least one card", "Tria almenys una carta"],
  ["Blanco", "White", "Blanc"], ["Azul", "Blue", "Blau"], ["Negro", "Black", "Negre"], ["Rojo", "Red", "Vermell"], ["Verde", "Green", "Verd"],
  ["Agresivo", "Aggro", "Agressiva"], ["Medio rango", "Midrange", "Mig rang"], ["Control", "Control", "Control"],
  ["Agresivo: baja criaturas baratas desde el turno 1 y ataca cada turno, para ganar antes de que el rival se organice.", "Aggro: play cheap creatures from turn 1 and attack every turn, to win before the opponent gets set up.", "Agressiva: baixa criatures barates des del torn 1 i ataca cada torn, per guanyar abans que el rival s'organitzi."],
  ["Medio rango: amenazas sólidas y buenas respuestas. Aguanta el principio y gana a medio plazo con cartas más potentes.", "Midrange: solid threats and good answers. Survive the early game and win in the mid game with stronger cards.", "Mig rang: amenaces sòlides i bones respostes. Aguanta el principi i guanya a mitja partida amb cartes més potents."],
  ["Control: responde a lo que haga el rival (quitar amenazas, robar cartas) y gana al final con pocas amenazas grandes.", "Control: answer whatever the opponent does (removal, card draw) and win late with a few big threats.", "Control: respon al que faci el rival (treure amenaces, robar cartes) i guanya al final amb poques amenaces grans."],
  ["carta base del mazo", "deck's base card", "carta base de la baralla"], ["buena carta del color", "good card in these colours", "bona carta del color"], ["encaja con el plan", "fits the plan", "encaixa amb el pla"],
  ["tierra básica", "basic land", "terra bàsica"], ["comandante", "commander", "comandant"], ["acelera el maná", "ramps mana", "accelera el maná"], ["roba cartas", "draws cards", "roba cartes"],
  ["quita amenazas del rival", "removes the opponent's threats", "treu amenaces del rival"], ["barre la mesa", "sweeps the board", "escombra la taula"],

  // Consejos de la guía (uno por tema)
  ["Llena la mesa de fichas y aprovéchalas: ataca en grupo, sacrifícalas o potencia a todas a la vez.", "Fill the board with tokens and use them: attack together, sacrifice them or pump them all at once.", "Omple la taula de fitxes i aprofita-les: ataca en grup, sacrifica-les o potencia-les totes alhora."],
  ["Sacrifica las criaturas que ya han cumplido (fichas, o las que hacen algo al entrar o al morir) para sacar valor extra.", "Sacrifice creatures that have done their job (tokens, or ones with enter/death effects) for extra value.", "Sacrifica les criatures que ja han complert (fitxes, o les que fan alguna cosa en entrar o en morir) per treure'n valor extra."],
  ["Tu cementerio es un recurso: llénalo pronto y recupera o lanza cartas desde él.", "Your graveyard is a resource: fill it early and recover or cast cards from it.", "El teu cementiri és un recurs: omple'l aviat i recupera o llança cartes des d'allà."],
  ["Lanza muchos hechizos baratos: cada instantáneo o conjuro activa a las cartas que los premian.", "Cast lots of cheap spells: every instant or sorcery triggers the cards that reward them.", "Llança molts encanteris barats: cada instantani o conjur activa les cartes que els premien."],
  ["Juega muchos artefactos baratos: hacen más fuertes a las cartas que cuentan artefactos.", "Play lots of cheap artifacts: they make the cards that count artifacts stronger.", "Juga molts artefactes barats: fan més fortes les cartes que compten artefactes."],
  ["Pon contadores pronto y multiplícalos (proliferar) para que tus amenazas crezcan turno a turno.", "Add counters early and multiply them (proliferate) so your threats grow every turn.", "Posa comptadors aviat i multiplica'ls (proliferar) perquè les teves amenaces creixin torn a torn."],
  ["Pon contadores +1/+1 desde el principio: tus criaturas crecen y algunas cartas los premian.", "Add +1/+1 counters from the start: your creatures grow and some cards reward it.", "Posa comptadors +1/+1 des del principi: les teves criatures creixen i algunes cartes ho premien."],
  ["Encadena efectos de ganar vida: cada vez que ganas vida, tus cartas te dan algo a cambio.", "Chain life-gain effects: every time you gain life, your cards give you something back.", "Encadena efectes de guanyar vida: cada vegada que guanyes vida, les teves cartes et donen alguna cosa a canvi."],
  ["Gana por el aire: tus voladores pasan por encima de las defensas del rival.", "Win in the air: your flyers go over the opponent's defences.", "Guanya per l'aire: els teus voladors passen per sobre de les defenses del rival."],
  ["Pon las auras en una criatura difícil de quitar y ataca con ella; no lo apuestes todo a una criatura frágil.", "Put auras on a creature that's hard to remove and attack; don't bet everything on a fragile one.", "Posa les aures en una criatura difícil de treure i ataca amb ella; no ho apostis tot a una criatura fràgil."],
  ["Equipa a criaturas baratas y ataca; si una muere, el equipo se queda para la siguiente.", "Equip cheap creatures and attack; if one dies, the equipment stays for the next.", "Equipa criatures barates i ataca; si una mor, l'equip es queda per a la següent."],
  ["Juega encantamientos de forma constante: muchas de tus cartas crecen con cada uno que entra.", "Keep playing enchantments: many of your cards grow with each one that enters.", "Juga encantaments de manera constant: moltes de les teves cartes creixen amb cada un que entra."],
  ["Roba mucho para encontrar tus piezas clave y no quedarte nunca sin cartas.", "Draw a lot to find your key pieces and never run out of cards.", "Roba molt per trobar les peces clau i no quedar-te mai sense cartes."],
  ["Descarta cartas que te conviene tener en el cementerio, o deja al rival sin mano.", "Discard cards you want in the graveyard, or empty the opponent's hand.", "Descarta cartes que et convé tenir al cementiri, o deixa el rival sense mà."],
  ["Muele cartas para llenar cementerios y, si es tu plan, para dejar al rival sin biblioteca.", "Mill cards to fill graveyards and, if that's your plan, to empty the opponent's library.", "Mol cartes per omplir cementiris i, si és el teu pla, per deixar el rival sense biblioteca."],
  ["Juega una tierra cada turno (o más): cada tierra que entra activa tus efectos de aterrizaje.", "Play a land every turn (or more): each land that enters triggers your landfall effects.", "Juga una terra cada torn (o més): cada terra que entra activa els teus efectes d'aterratge."],
  ["Aprovecha lo que hacen tus criaturas al entrar: haz que salgan y vuelvan a entrar para repetirlo.", "Use your creatures' enter effects: make them leave and re-enter to repeat them.", "Aprofita el que fan les teves criatures en entrar: fes que surtin i tornin a entrar per repetir-ho."],
  ["Exilia y devuelve tus propias criaturas (parpadeo) para repetir sus efectos al entrar.", "Exile and return your own creatures (blink) to repeat their enter effects.", "Exilia i retorna les teves pròpies criatures (parpelleig) per repetir els seus efectes en entrar."],
  ["Devuelve tus criaturas a la mano y vuelve a jugarlas para repetir sus efectos; úsalo también para quitar bloqueadores.", "Bounce your creatures and replay them to repeat their effects; also use it to remove blockers.", "Retorna les teves criatures a la mà i torna-les a jugar per repetir-ne els efectes; fes-ho servir també per treure bloquejadors."],
  ["Usa el daño directo para quitar bloqueadores al principio y rematar al rival al final.", "Use direct damage to remove blockers early and finish the opponent off late.", "Fes servir el dany directe per treure bloquejadors al principi i rematar el rival al final."],
  ["Con 10 contadores de veneno el rival pierde: ataca con tus criaturas infectadas y protégelas.", "With 10 poison counters the opponent loses: attack with your infect creatures and protect them.", "Amb 10 comptadors de verí el rival perd: ataca amb les teves criatures infectades i protegeix-les."],
  ["Ataca cada turno: muchas de tus cartas se activan al atacar o tienen prisa.", "Attack every turn: many of your cards trigger on attack or have haste.", "Ataca cada torn: moltes de les teves cartes s'activen en atacar o tenen pressa."],
  ["Protege a tus planeswalkers con criaturas y quitando amenazas: cada turno que sobreviven te dan ventaja.", "Protect your planeswalkers with creatures and removal: every turn they survive gives you an edge.", "Protegeix els teus planeswalkers amb criatures i traient amenaces: cada torn que sobreviuen et donen avantatge."],
  ["Prioriza tus cartas legendarias: el mazo las premia.", "Prioritise your legendary cards: the deck rewards them.", "Prioritza les teves cartes llegendàries: la baralla les premia."],
  ["Ten criaturas pequeñas para tripular tus vehículos.", "Keep small creatures around to crew your vehicles.", "Tingues criatures petites per tripular els teus vehicles."],
  ["Llena la mesa de criaturas: tus cartas premian tener muchas a la vez.", "Fill the board with creatures: your cards reward having many at once.", "Omple la taula de criatures: les teves cartes premien tenir-ne moltes alhora."],

  // Escáner
  ["Abriendo la cámara…", "Opening the camera…", "Obrint la càmera…"], ["Preparando el lector…", "Preparing the reader…", "Preparant el lector…"],
  ["Coloca la carta dentro del marco · toca para enfocar", "Place the card inside the frame · tap to focus", "Col·loca la carta dins del marc · toca per enfocar"],
  ["Coloca la carta dentro del marco, con buena luz y sin reflejos", "Place the card inside the frame, with good light and no glare", "Col·loca la carta dins del marc, amb bona llum i sense reflexos"],
  ["Coloca la siguiente carta", "Place the next card", "Col·loca la carta següent"], ["Añadida ✓ · Pon la siguiente carta", "Added ✓ · Next card", "Afegida ✓ · Posa la carta següent"],
  ["No veo texto: acerca la carta o dale más luz", "I can't see text: bring the card closer or add light", "No veig text: apropa la carta o dona-li més llum"],
  ["📷 Foto", "📷 Photo", "📷 Foto"], ["🔦 Linterna", "🔦 Torch", "🔦 Llanterna"], ["Cerrar escáner", "Close scanner", "Tancar l'escàner"],
  ["No se puede usar la cámara en directo; usa una foto", "Live camera isn't available; use a photo", "No es pot fer servir la càmera en directe; fes servir una foto"],
  ["Leyendo la carta…", "Reading the card…", "Llegint la carta…"], ["Preparando el lector (la primera vez tarda un poco)…", "Preparing the reader (the first time takes a moment)…", "Preparant el lector (la primera vegada triga una mica)…"],
  ["No he podido leerla", "I couldn't read it", "No l'he pogut llegir"], ["Nombre de la carta…", "Card name…", "Nom de la carta…"], ["Volver a escanear", "Scan again", "Tornar a escanejar"],
  ["No he reconocido el nombre", "I didn't recognise the name", "No he reconegut el nom"], ["No se ha podido abrir la foto", "Couldn't open the photo", "No s'ha pogut obrir la foto"],

  // Mercado, predicciones y sinergias
  ["📈 Movimientos", "📈 Movers", "📈 Moviments"], ["🔮 Predicciones", "🔮 Predictions", "🔮 Prediccions"], ["🧩 Sinergias", "🧩 Synergies", "🧩 Sinergies"],
  ["Legales en Pauper", "Pauper legal", "Legals a Pauper"], ["1 día", "1 day", "1 dia"], ["7 días", "7 days", "7 dies"], ["30 días", "30 days", "30 dies"],
  ["📈 Suben", "📈 Rising", "📈 Pugen"], ["📉 Bajan", "📉 Falling", "📉 Baixen"], ["Acumulando historial", "Building history", "Acumulant historial"],
  ["Señales para comprar antes de que suban (precios de Cardmarket). Son pistas, no garantías. Toca una carta para ver con qué combina.",
    "Signals to buy before prices rise (Cardmarket prices). Hints, not guarantees. Tap a card to see what it combos with.",
    "Senyals per comprar abans que pugin (preus de Cardmarket). Són pistes, no garanties. Toca una carta per veure amb què combina."],
  ["Señales para comprar antes de que suban (precios de Cardmarket). Son pistas, no garantías.", "Signals to buy before prices rise (Cardmarket prices). Hints, not guarantees.", "Senyals per comprar abans que pugin (preus de Cardmarket). Són pistes, no garanties."],
  ["💎 Baratas que pueden volver a subir", "💎 Cheap cards that may bounce back", "💎 Barates que poden tornar a pujar"],
  ["Bajaron mucho en 30 días, ya no bajan y se siguen jugando.", "They dropped a lot in 30 days, stopped falling and are still played.", "Van baixar molt en 30 dies, ja no baixen i es continuen jugant."],
  ["🚀 Empiezan a subir", "🚀 Starting to rise", "🚀 Comencen a pujar"], ["Estaban planas y esta semana suben un 15% o más.", "They were flat and are up 15% or more this week.", "Estaven planes i aquesta setmana pugen un 15% o més."],
  ["🔥 Muy jugadas y baratas", "🔥 Heavily played and cheap", "🔥 Molt jugades i barates"], ["Están en varios mazos del meta de Pauper y cuestan poco.", "They're in several Pauper meta decks and cost little.", "Són a diverses baralles del meta de Pauper i costen poc."],
  ["📜 Lista Reservada más jugada", "📜 Most played Reserved List", "📜 Llista Reservada més jugada"], ["No se reimprimen nunca: con el tiempo suelen subir.", "Never reprinted: over time they tend to rise.", "No es reimprimeixen mai: amb el temps solen pujar."],
  ["Hace falta más historial de precios: se va guardando cada día y esta lista se llenará sola.", "More price history is needed: it's saved every day and this list will fill up on its own.", "Cal més historial de preus: es desa cada dia i aquesta llista s'omplirà sola."],
  ["Ahora mismo ninguna cumple las condiciones.", "None meet the conditions right now.", "Ara mateix cap compleix les condicions."], ["Esta semana ninguna.", "None this week.", "Aquesta setmana cap."], ["Sin datos del meta todavía.", "No meta data yet.", "Encara sense dades del meta."],
  ["Lista Reservada: nunca se reimprime y se juega mucho; a la larga suele subir.", "Reserved List: never reprinted and heavily played; it tends to rise over time.", "Llista Reservada: no es reimprimeix mai i es juga molt; a la llarga sol pujar."],
  ["Estaba plana y ha empezado a subir esta semana: si sigue la tendencia, mejor comprarla ya.", "It was flat and started rising this week: if the trend holds, better buy it now.", "Estava plana i ha començat a pujar aquesta setmana: si segueix la tendència, millor comprar-la ja."],
  ["Cuando sale una colección, algunas cartas antiguas suben porque combinan con las nuevas. Aquí las ves antes.", "When a set comes out, some older cards rise because they combo with the new ones. See them here first.", "Quan surt una col·lecció, algunes cartes antigues pugen perquè combinen amb les noves. Aquí les veus abans."],
  ["🆕 Colecciones nuevas", "🆕 New sets", "🆕 Col·leccions noves"], ["🔍 Con cualquier carta", "🔍 With any card", "🔍 Amb qualsevol carta"],
  ["Busca una carta (de cualquier colección)…", "Search a card (from any set)…", "Cerca una carta (de qualsevol col·lecció)…"], ["No hay colecciones recientes.", "No recent sets.", "No hi ha col·leccions recents."],
  ["Sinergias de la colección", "Set synergies", "Sinergies de la col·lecció"], ["Analizando las cartas nuevas (la primera vez tarda unos segundos)…", "Analysing the new cards (the first time takes a few seconds)…", "Analitzant les cartes noves (la primera vegada triga uns segons)…"],
  ["Cartas antiguas y baratas que combinan con las nuevas: suelen subir cuando la colección sale. Toca una para ver más.", "Older, cheap cards that combo with the new ones: they often rise when the set is released. Tap one for more.", "Cartes antigues i barates que combinen amb les noves: solen pujar quan surt la col·lecció. Toca'n una per veure'n més."],
  ["No he encontrado sinergias claras.", "I didn't find clear synergies.", "No he trobat sinergies clares."],
  ["Las cartas de todo Magic que mejor encajan con ella. \"La tienes\" = está en tu carpeta.", "The cards from all of Magic that fit it best. \"You have it\" = it's in your binder.", "Les cartes de tot Magic que hi encaixen millor. \"La tens\" = és a la teva carpeta."],

  // Avisos
  ["Baneos en Pauper, colecciones nuevas, cambios en el meta y movimientos de precio de tus cartas. Se revisan cada día a las 9:00.", "Pauper bans, new sets, meta changes and price moves of your cards. Checked every day.", "Prohibicions a Pauper, col·leccions noves, canvis al meta i moviments de preu de les teves cartes. Es revisen cada dia."],
  ["Sin avisos todavía", "No alerts yet", "Encara no hi ha avisos"],
  ["Cuando haya un baneo, una colección nueva o una carta tuya se mueva más de un 10%, aparecerá aquí y en el móvil.", "When there's a ban, a new set, or one of your cards moves more than 10%, it will show up here and on your phone.", "Quan hi hagi una prohibició, una col·lecció nova o una carta teva es mogui més d'un 10%, apareixerà aquí i al mòbil."],
  ["Es una colección que sigues.", "It's a set you follow.", "És una col·lecció que segueixes."],
  ["Revisa qué cartas antiguas pueden subir.", "Check which older cards may rise.", "Revisa quines cartes antigues poden pujar."],
];

// Temas del constructor (aparecen sueltos y dentro de los motivos).
const THEME_WORDS = [
  ["planeswalkers", "planeswalkers", "planeswalkers"], ["contadores +1/+1", "+1/+1 counters", "comptadors +1/+1"], ["contadores", "counters", "comptadors"],
  ["legendarios", "legendaries", "llegendàries"], ["vehículos", "vehicles", "vehicles"], ["artefactos", "artifacts", "artefactes"], ["fichas", "tokens", "fitxes"],
  ["sacrificio", "sacrifice", "sacrifici"], ["cementerio", "graveyard", "cementiri"], ["hechizos", "spells", "encanteris"], ["ganar vida", "lifegain", "guanyar vida"],
  ["vuelo", "flying", "vol"], ["auras", "auras", "aures"], ["encantamientos", "enchantments", "encantaments"], ["equipos", "equipment", "equips"],
  ["robar cartas", "card draw", "robar cartes"], ["descarte", "discard", "descart"], ["molino", "mill", "molí"], ["tierras", "lands", "terres"],
  ["efectos al entrar", "enter effects", "efectes en entrar"], ["parpadeo", "blink", "parpelleig"], ["devolver a la mano", "bounce", "retornar a la mà"],
  ["daño directo", "direct damage", "dany directe"], ["veneno", "poison", "verí"], ["atacar", "attacking", "atacar"], ["criaturas", "creatures", "criatures"],
  ["blanco", "white", "blanc"], ["azul", "blue", "blau"], ["negro", "black", "negre"], ["rojo", "red", "vermell"], ["verde", "green", "verd"],
];

// Frases con datos. Se aplican en orden sobre cada texto (los nombres de cartas se conservan).
const RULES = [
  [/^(Criaturas|Hechizos|Tierras|Main|Sideboard) \((\d+)\)$/, (m) => `${({ Criaturas: "Creatures", Hechizos: "Spells", Tierras: "Lands" })[m[1]] || m[1]} (${m[2]})`,
    (m) => `${({ Criaturas: "Criatures", Hechizos: "Encanteris", Tierras: "Terres", Sideboard: "Banqueta" })[m[1]] || m[1]} (${m[2]})`],
  [/^(\d+) cartas? · Cardmarket, /, "$1 cards · Cardmarket, ", "$1 cartes · Cardmarket, "],
  [/^(\d+) carta · /, "$1 card · ", "$1 carta · "],
  [/ desde ayer$/, " since yesterday", " des d'ahir"],
  [/^(\d+) cartas?$/, "$1 cards", "$1 cartes"],
  [/ · (\d+) cartas$/, " · $1 cards", " · $1 cartes"],
  [/^Tienes (\S+) de (\S+)$/, "You have $1 of $2", "Tens $1 de $2"],
  [/^Tienes \((\d+)%\)$/, "You own ($1%)", "Tens ($1%)"],
  [/^Tienes el (\d+)%$/, "You own $1%", "Tens el $1%"],
  [/^Te faltan (.+)$/, "Missing $1", "Et falten $1"],
  [/^Me faltan \((\d+)\)$/, "Missing ($1)", "Em falten ($1)"],
  [/^Compartir lo que falta \((\d+)\)$/, "Share what's missing ($1)", "Compartir el que falta ($1)"],
  [/^Añadir 1 de cada \((\d+)\)$/, "Add 1 of each ($1)", "Afegir 1 de cada ($1)"],
  [/^(\d+) cartas? añadidas?( \(foil\))?$/, "$1 cards added$2", "$1 cartes afegides$2"],
  [/^(\d+)× (.+) añadida$/, "$1× $2 added", "$1× $2 afegida"],
  [/^(\d+) cartas importadas$/, "$1 cards imported", "$1 cartes importades"],
  [/^(\d+) elegidas?$/, "$1 picked", "$1 triades"],
  [/^Ver más \((\d+)\)$/, "See more ($1)", "Veure'n més ($1)"],
  [/^Siguiendo (.+)$/, "Following $1", "Seguint $1"],
  [/^Carpeta "(.+)" creada$/, "Binder \"$1\" created", "Carpeta \"$1\" creada"],
  [/^Mazo guardado \((\d+) cartas distintas\)$/, "Deck saved ($1 unique cards)", "Baralla desada ($1 cartes diferents)"],
  [/ el mazo/, " the deck", " la baralla"],
  [/🏆 Ganadora en /, "🏆 Winner at ", "🏆 Guanyadora a "], [/🏆 Ganadora/, "🏆 Winner", "🏆 Guanyadora"],
  [/(\d+(?:-\d+)?)º en /, "#$1 at ", "$1a a "],
  [/^Arte y edición: (.+) \((\d+) versiones\)$/, "Art and printing: $1 ($2 versions)", "Art i edició: $1 ($2 versions)"],
  [/^Mazo con (.+)$/, "Deck with $1", "Baralla amb $1"],
  [/^Combinan con (.+)$/, "Combo with $1", "Combinen amb $1"],
  [/^🔮 Ver (.+) en Cardmarket$/, "🔮 See $1 on Cardmarket", "🔮 Veure $1 a Cardmarket"], [/^🛒 Ver (.+) en Cardmarket$/, "🛒 See $1 on Cardmarket", "🛒 Veure $1 a Cardmarket"],
  [/^📜 Ver la colección (.+)$/, "📜 See the set $1", "📜 Veure la col·lecció $1"],
  [/^🔨 Crear un mazo con esta carta( \(o de Commander\))?$/, (m) => `🔨 Build a deck with this card${m[1] ? " (or Commander)" : ""}`, (m) => `🔨 Crear una baralla amb aquesta carta${m[1] ? " (o de Commander)" : ""}`],
  [/^(\d+) cartas nuevas · /, "$1 new cards · ", "$1 cartes noves · "],
  [/^📅 Sale el (.+)$/, "📅 Out on $1", "📅 Surt el $1"], [/^Salió el (.+)$/, "Released $1", "Va sortir el $1"],
  [/^Curva de maná · media (.+)$/, "Mana curve · average $1", "Corba de maná · mitjana $1"],
  [/^(\d+) criaturas y (\d+) hechizos\. Debajo de cada carta, por qué está\.$/, "$1 creatures and $2 spells. Under each card, why it's there.", "$1 criatures i $2 encanteris. Sota cada carta, per què hi és."],
  [/^(\d+) quitan amenazas$/, "$1 removal", "$1 treuen amenaces"], [/^(\d+) roban$/, "$1 draw", "$1 roben"],
  [/^(\d+) aceleran maná$/, "$1 ramp", "$1 acceleren maná"], [/^(\d+) barridos$/, "$1 sweepers", "$1 escombrades"],
  [/^Del (.+) al (.+) · solo cartas de 0,50 € o más$/, "From $1 to $2 · only cards worth €0.50 or more", "Del $1 al $2 · només cartes de 0,50 € o més"],
  [/^Hay precios del (.+)\. Las subidas y bajadas aparecerán a partir de mañana, y la vista semanal en 7 días\.$/, "Prices from $1. Rises and falls will appear from tomorrow, and the weekly view in 7 days.", "Hi ha preus del $1. Les pujades i baixades apareixeran a partir de demà, i la vista setmanal en 7 dies."],
  [/^Leo: «(.*)»$/, "Reading: «$1»", "Llegeixo: «$1»"], [/^Leyendo… (.+)$/, "Reading… $1", "Llegint… $1"],
  [/^Me falta para (.+)$/, "Missing for $1", "Em falta per a $1"], [/^Me falta de (.+)$/, "Missing from $1", "Em falta de $1"],
  [/^¿Borrar "(.+)" y sus (\d+) cartas\? No se puede deshacer\.$/, "Delete \"$1\" and its $2 cards? This can't be undone.", "Esborrar \"$1\" i les seves $2 cartes? No es pot desfer."],
  [/^¿Borrar "(.+)" de Mis mazos\?$/, "Remove \"$1\" from My decks?", "Esborrar \"$1\" de Les meves baralles?"],
  // Motor: motivos y avisos
  [/^sinergia: (.+)$/, (m) => `synergy: ${words(m[1], "en")}`, (m) => `sinergia: ${words(m[1], "ca")}`],
  [/^Sinergia: (.+)\.$/, (m) => `Synergy: ${words(m[1], "en")}.`, (m) => `Sinergia: ${words(m[1], "ca")}.`],
  [/^tribal: (.+)$/, "tribal: $1", "tribal: $1"], [/^tribu (.+)$/, "tribe $1", "tribu $1"],
  [/^da maná (.+)$/, (m) => `makes ${words(m[1].replace(/ y /g, " and "), "en")} mana`, (m) => `dona maná ${words(m[1].replace(/ y /g, " i "), "ca")}`],
  [/^Combina con (.+) \(nueva\): (.+)\.$/, (m) => `Combos with ${m[1]} (new): ${words(m[2], "en")}.`, (m) => `Combina amb ${m[1]} (nova): ${words(m[2], "ca")}.`],
  [/^Se juega en (\d+) mazos del meta de Pauper y aún es barata: si sube la demanda, sube el precio\.$/, "Played in $1 Pauper meta decks and still cheap: if demand rises, so does the price.", "Es juga a $1 baralles del meta de Pauper i encara és barata: si puja la demanda, puja el preu."],
  [/^Ha bajado (\d+)% en 30 días y ya no baja; se sigue jugando, así que puede volver a subir\.$/, "Down $1% in 30 days and no longer falling; still played, so it may bounce back.", "Ha baixat un $1% en 30 dies i ja no baixa; es continua jugant, així que pot tornar a pujar."],
  [/^No tienes (.+) en esta carpeta; el mazo está montado a su alrededor igualmente\.$/, "You don't have $1 in this binder; the deck is built around it anyway.", "No tens $1 en aquesta carpeta; la baralla està muntada al seu voltant igualment."],
  [/^Para Commander la carta base tiene que ser una criatura legendaria\. He montado un mazo de 100 cartas con (.+) igualmente\.$/, "For Commander the base card must be a legendary creature. I built a 100-card deck with $1 anyway.", "Per a Commander la carta base ha de ser una criatura llegendària. He muntat una baralla de 100 cartes amb $1 igualment."],
  [/^(.+) no (?:es legal|son legales) en (Pauper|Estándar); he montado el mazo en Casual\.$/, (m) => `${m[1]} isn't legal in ${m[2] === "Pauper" ? "Pauper" : "Standard"}; I built the deck as Casual.`, (m) => `${m[1]} no és legal a ${m[2] === "Pauper" ? "Pauper" : "Estàndard"}; he muntat la baralla en Casual.`],
  [/^El plan pide (.+?) y (solo hay (\d+)|no hay ninguna) en la carpeta( \(legales en Pauper\))?\.(.*)$/, (m) => `The plan needs ${words(m[1], "en")} and ${m[3] ? `there are only ${m[3]}` : "there are none"} in the binder${m[4] ? " (Pauper legal)" : ""}.${tr(m[5].trim(), "en") ? " " + tr(m[5].trim(), "en") : ""}`,
    (m) => `El pla demana ${words(m[1], "ca")} i ${m[3] ? `només n'hi ha ${m[3]}` : "no n'hi ha cap"} a la carpeta${m[4] ? " (legals a Pauper)" : ""}.${tr(m[5].trim(), "ca") ? " " + tr(m[5].trim(), "ca") : ""}`],
  [/^Tienes más cartas de (.+) en (.+): añade (esos colores|ese color) arriba\.$/, (m) => `You have more ${words(m[1], "en")} cards in ${words(m[2].replace(/ y /g, " and "), "en")}: add ${m[3] === "ese color" ? "that colour" : "those colours"} above.`,
    (m) => `Tens més cartes de ${words(m[1], "ca")} en ${words(m[2].replace(/ y /g, " i "), "ca")}: afegeix ${m[3] === "ese color" ? "aquest color" : "aquests colors"} a dalt.`],
  [/^Pocas cartas que (.+) \((\d+) de ~(\d+) recomendadas\)\. Si consigues alguna, el mazo mejorará\.$/, (m) => `Few cards that ${({ "acelera el maná": "ramp mana", "roba cartas": "draw cards", "quita amenazas del rival": "remove threats", "barre la mesa": "sweep the board" })[m[1]] || m[1]} (${m[2]} of ~${m[3]} recommended). Getting some will improve the deck.`,
    (m) => `Poques cartes que ${({ "acelera el maná": "acceleren el maná", "roba cartas": "roben cartes", "quita amenazas del rival": "treuen amenaces", "barre la mesa": "escombren la taula" })[m[1]] || m[1]} (${m[2]} de ~${m[3]} recomanades). Si n'aconsegueixes alguna, la baralla millorarà.`],
  [/^Solo hay (\d+) cartas que encajen \(harían falta (\d+)\)\. Prueba otro color o Casual, o añade cartas a la carpeta\.$/, "Only $1 cards fit ($2 needed). Try another colour or Casual, or add cards to the binder.", "Només hi ha $1 cartes que encaixin (en caldrien $2). Prova un altre color o Casual, o afegeix cartes a la carpeta."],
  [/^es lo que pide la carta base: (.+)$/, (m) => `what the base card asks for: ${words(m[1], "en")}`, (m) => `és el que demana la carta base: ${words(m[1], "ca")}`],
  // Guía del mazo
  [/^(.+) Cartas: (.+)\.$/, (m) => `${tr(m[1], "en")} Cards: ${m[2]}.`, (m) => `${tr(m[1], "ca")} Cartes: ${m[2]}.`],
  [/^Juega muchos (.+): se potencian entre ellos, así que cuantos más tengas en mesa, mejor\.$/, "Play lots of $1: they pump each other, so the more on the board, the better.", "Juga molts $1: es potencien entre ells, així que com més en tinguis a taula, millor."],
  [/^(.+) \+ (.+): (.+) aporta (.+) y (.+) lo aprovecha \((.+)\)\.$/, (m) => `${m[1]} + ${m[2]}: ${m[3]} provides ${words(m[4], "en")} and ${m[5]} uses it (${words(m[6], "en")}).`, (m) => `${m[1]} + ${m[2]}: ${m[3]} aporta ${words(m[4], "ca")} i ${m[5]} ho aprofita (${words(m[6], "ca")}).`],
  [/^Turnos 1-2: (.+)\.$/, "Turns 1-2: $1.", "Torns 1-2: $1."],
  [/^Turnos 3-4: (.+?)(, y guarda maná para responder)?\.$/, (m) => `Turns 3-4: ${m[1]}${m[2] ? ", and keep mana up to respond" : ""}.`, (m) => `Torns 3-4: ${m[1]}${m[2] ? ", i guarda maná per respondre" : ""}.`],
  [/^Cuando tengas el maná, (.+); si te lo quitan, vuelve a jugarlo desde la zona de mando\.$/, "When you have the mana, $1; if it's removed, recast it from the command zone.", "Quan tinguis el maná, $1; si te'l treuen, torna'l a jugar des de la zona de comandament."],
  [/^Del turno 5 en adelante: (.+) para cerrar la partida\.$/, "Turn 5 onwards: $1 to close out the game.", "Del torn 5 endavant: $1 per tancar la partida."],
  [/^Quédate manos con 2-3 tierras \(el mazo lleva (\d+)\) y al menos dos cartas de coste 1-2\. Con 0-1 o 5\+ tierras, mulligan\.$/, "Keep hands with 2-3 lands (the deck runs $1) and at least two 1-2 mana cards. With 0-1 or 5+ lands, mulligan.", "Queda't mans amb 2-3 terres (la baralla en porta $1) i almenys dues cartes de cost 1-2. Amb 0-1 o 5+ terres, mulligan."],
  [/^Quédate manos con 3-4 tierras \(el mazo lleva (\d+)\) y algo para responder\. Con 1 tierra o con 6\+, mulligan\.$/, "Keep hands with 3-4 lands (the deck runs $1) and something to respond with. With 1 land or 6+, mulligan.", "Queda't mans amb 3-4 terres (la baralla en porta $1) i alguna cosa per respondre. Amb 1 terra o amb 6+, mulligan."],
  [/^Quédate manos con 2-4 tierras \(el mazo lleva (\d+)\) y alguna jugada para los turnos 2-3\. Con 0-1 o 5\+ tierras, mulligan\.$/, "Keep hands with 2-4 lands (the deck runs $1) and a play for turns 2-3. With 0-1 or 5+ lands, mulligan.", "Queda't mans amb 2-4 terres (la baralla en porta $1) i alguna jugada per als torns 2-3. Amb 0-1 o 5+ terres, mulligan."],
  // Avisos generados cada día
  [/^🚫 Baneada en Pauper: (.+)$/, "🚫 Banned in Pauper: $1", "🚫 Prohibida a Pauper: $1"], [/^✅ Desbaneada en Pauper: (.+)$/, "✅ Unbanned in Pauper: $1", "✅ Desprohibida a Pauper: $1"],
  [/^🆕 Nueva colección: (.+)$/, "🆕 New set: $1", "🆕 Nova col·lecció: $1"], [/^📜 Hoy sale (.+)$/, "📜 Out today: $1", "📜 Avui surt $1"],
  [/^Sale el (.+)\. Revisa qué cartas antiguas pueden subir\.$/, "Out on $1. Check which older cards may rise.", "Surt el $1. Revisa quines cartes antigues poden pujar."],
  [/^📊 Nuevo en el top de Pauper: (.+)$/, "📊 New in the Pauper top: $1", "📊 Nou al top de Pauper: $1"],
  [/^📊 (.+) (sube|baja) en el meta$/, (m) => `📊 ${m[1]} ${m[2] === "sube" ? "rises" : "falls"} in the meta`, (m) => `📊 ${m[1]} ${m[2] === "sube" ? "puja" : "baixa"} al meta`],
  [/^Ahora tiene un (\d+)% del meta\.$/, "It now has $1% of the meta.", "Ara té un $1% del meta."], [/^Del (\d+)% al (\d+)%\.$/, "From $1% to $2%.", "Del $1% al $2%."],
  [/\(mazos top Pauper\)/, "(top Pauper decks)", "(baralles top Pauper)"],
  [/^Precio más barato: (.+)$/, "Cheapest price: $1", "Preu més barat: $1"], [/^Tu carta: (.+)$/, "Your card: $1", "La teva carta: $1"],
];

const COL = { en: 1, ca: 2 };
const EXACT_MAP = new Map(EXACT.map((r) => [r[0], r[COL[LANG]] || r[0]]));
const WORD_MAP = new Map(THEME_WORDS.map((r) => [r[0], r[COL[LANG]] || r[0]]));
/** Traduce una lista de temas/colores separados por comas ("fichas, sacrificio"). */
function words(s, lang = LANG) {
  const m = new Map(THEME_WORDS.map((r) => [r[0], r[COL[lang]] || r[0]]));
  return s.split(/, /).map((w) => m.get(w) || w).join(", ");
}
const isFull = (re) => re.source.startsWith("^") && re.source.endsWith("$");
const apply = (re, to, s) => {
  const m = re.exec(s);
  if (!m) return null;
  return typeof to === "function" ? s.slice(0, m.index) + to(m) + s.slice(m.index + m[0].length) : s.replace(re, to);
};
/** Traduce un texto (sin espacios alrededor). partial=false: solo frases completas (exactas o reglas ^…$). */
function tr(s, lang = LANG, partial = true) {
  if (lang === "es" || !s) return s;
  const exact = lang === LANG ? EXACT_MAP : new Map(EXACT.map((r) => [r[0], r[COL[lang]] || r[0]]));
  if (exact.has(s)) return exact.get(s);
  if (WORD_MAP.has(s) && lang === LANG) return WORD_MAP.get(s);
  for (const [re, en, ca] of RULES) {  // 1) frases completas
    if (!isFull(re)) continue;
    const out = apply(re, lang === "en" ? en : ca, s);
    if (out != null) return out;
  }
  if (!partial) return s;
  let out = s;  // 2) trozos sueltos ("… el mazo", "🏆 Ganadora en …")
  for (const [re, en, ca] of RULES) {
    if (isFull(re)) continue;
    const r = apply(re, lang === "en" ? en : ca, out);
    if (r != null) out = r;
  }
  return out;
}
window.t = (s) => tr(s);  // para confirm() y alert()

// Prueba la frase entera; si no, sin el emoji/símbolo del principio ("⚠️ Solo hay…"); y si son
// varias frases en el mismo texto, una a una.
function trLoose(s) {
  let out = tr(s, LANG, false);
  if (out !== s) return out;
  const m = /^([^\p{L}\d"¿¡(]+)(.+)$/u.exec(s);
  if (m && (out = tr(m[2], LANG, false)) !== m[2]) return m[1] + out;
  if (/[.:!?] \S/.test(s)) {
    const parts = s.split(/(?<=[.:!?]) (?=\S)/);
    const done = parts.map((p) => tr(p, LANG, false));
    if (done.some((p, i) => p !== parts[i])) return done.join(" ");
  }
  return tr(s);  // al final, trozos sueltos
}
function translateText(node) {
  const raw = node.nodeValue;
  const core = raw.trim().replace(/\s+/g, " ");
  if (!core || !/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(core)) return;
  const done = trLoose(core);
  if (done !== core) node.nodeValue = raw.replace(/\S[\s\S]*\S|\S/, done);
}
function translateTree(root) {
  if (LANG === "es") return;
  if (root.nodeType === Node.TEXT_NODE) return translateText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement && /^(SCRIPT|STYLE)$/.test(n.parentElement.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) translateText(n);
  const els = root.querySelectorAll ? [root, ...root.querySelectorAll("[placeholder],[aria-label],[title]")] : [root];
  for (const el of els) for (const a of ["placeholder", "aria-label", "title"]) {
    if (el.hasAttribute?.(a)) { const v = el.getAttribute(a); const t2 = tr(v); if (t2 !== v) el.setAttribute(a, t2); }
  }
}

if (LANG !== "es") {
  document.documentElement.lang = LANG;
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "characterData") translateText(m.target);
      else m.addedNodes.forEach(translateTree);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  document.addEventListener("DOMContentLoaded", () => translateTree(document.body));
}
