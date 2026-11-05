// ===================================================================
// Elokuvahaku – AJAX-sovellus, joka hakee dataa TMDB:n REST API:sta.
// Vain natiivi JavaScript (fetch + async/await), ei ulkoisia kirjastoja.
// ===================================================================

// ---------- Asetukset ----------

const API_OSOITE = "https://api.themoviedb.org/3";
const KUVA_OSOITE = "https://image.tmdb.org/t/p/";
const KIELI = "fi-FI"; // suomenkieliset nimet ja kuvaukset, kun niitä on

// API-avain tulee tiedostosta js/config.js. Jos tiedosto puuttuu, avain on tyhjä
// ja haku antaa selkeän virheilmoituksen (401) kaatumisen sijaan.
const API_AVAIN = typeof TMDB_API_KEY !== "undefined" ? TMDB_API_KEY : "";

// Listavalikon arvot ja niiden otsikot sivulla.
const LISTAT = {
    popular: "Suosituimmat",
    top_rated: "Parhaiten arvioidut",
    now_playing: "Teattereissa nyt",
    upcoming: "Tulossa"
};

// ---------- HTML-elementit ----------

const hakulomake = document.getElementById("hakulomake");
const hakukentta = document.getElementById("hakukentta");
const listavalikko = document.getElementById("listavalikko");
const genrevalikko = document.getElementById("genrevalikko");
const otsikko = document.getElementById("otsikko");
const tila = document.getElementById("tila");
const elokuvat = document.getElementById("elokuvat");
const lisaaNappi = document.getElementById("lisaa");
const tiedotIkkuna = document.getElementById("tiedot");
const tiedotSisalto = document.getElementById("tiedot-sisalto");
const suljeNappi = document.getElementById("sulje");

// ---------- Sovelluksen tila ----------

// Muistetaan, mitä näytetään nyt, jotta "Näytä lisää" osaa hakea seuraavan sivun samasta hausta.
// tyyppi: "lista" | "genre" | "haku", arvo: listan nimi, genren id tai hakusana.
let nykyinenHaku = { tyyppi: "lista", arvo: "popular", sivu: 1, sivujaYhteensa: 1 };

// Genrejen nimet id:n perusteella (esim. 28 → "Toiminta"), täytetään sivun latautuessa.
const genret = {};


// ===================================================================
// AJAX: datan haku API:sta
// ===================================================================

// Yleinen apufunktio: hakee annetusta TMDB-polusta JSON-datan.
// parametrit = olio, josta tehdään osoitteen kyselyosa (?query=...&page=...).
async function haeApista(polku, parametrit = {}) {
    // URLSearchParams muodostaa kyselyosan ja koodaa erikoismerkit (esim. välilyönnit).
    const kysely = new URLSearchParams({ api_key: API_AVAIN, language: KIELI, ...parametrit });
    const vastaus = await fetch(`${API_OSOITE}${polku}?${kysely}`);

    // fetch ei heitä virhettä HTTP-virhekoodeista, joten tarkistetaan tila itse.
    if (vastaus.status === 401) {
        throw new Error("API-avain puuttuu tai on virheellinen (katso js/config.js).");
    }
    if (!vastaus.ok) {
        throw new Error(`Palvelin vastasi virhekoodilla ${vastaus.status}.`);
    }
    // Muutetaan vastauksen JSON-teksti JavaScript-olioksi.
    return vastaus.json();
}

// Hakee genrelistan ja täyttää genrevalikon.
async function lataaGenret() {
    try {
        const data = await haeApista("/genre/movie/list");
        data.genres.forEach((genre) => {
            genret[genre.id] = genre.name;
            const vaihtoehto = document.createElement("option");
            vaihtoehto.value = genre.id;
            // Isolla alkukirjaimella (TMDB palauttaa osan suomeksi pienellä).
            vaihtoehto.textContent = isoAlkukirjain(genre.name);
            genrevalikko.appendChild(vaihtoehto);
        });
    } catch (virhe) {
        // Genrejen puuttuminen ei estä muuta käyttöä, joten kirjataan virhe vain konsoliin.
        console.error("Genrejen haku epäonnistui:", virhe);
    }
}

// Hakee elokuvat nykyisen haun perusteella. jatka = true lisää tulokset vanhojen perään.
async function haeElokuvat(jatka = false) {
    if (!jatka) {
        elokuvat.innerHTML = "";
    }
    naytaTila("Ladataan elokuvia…");
    lisaaNappi.hidden = true;

    try {
        let data;
        const sivu = { page: nykyinenHaku.sivu };

        // Valitaan oikea rajapinta haun tyypin mukaan.
        if (nykyinenHaku.tyyppi === "haku") {
            data = await haeApista("/search/movie", { ...sivu, query: nykyinenHaku.arvo });
        } else if (nykyinenHaku.tyyppi === "genre") {
            data = await haeApista("/discover/movie", {
                ...sivu,
                with_genres: nykyinenHaku.arvo,
                sort_by: "popularity.desc"
            });
        } else {
            data = await haeApista(`/movie/${nykyinenHaku.arvo}`, sivu);
        }

        // Tallennetaan sivujen määrä (TMDB sallii enintään 500 sivua).
        nykyinenHaku.sivujaYhteensa = Math.min(data.total_pages, 500);

        if (data.results.length === 0 && !jatka) {
            naytaTila("Ei tuloksia. Kokeile toista hakusanaa.");
            return;
        }

        naytaElokuvat(data.results);
        naytaTila("");
        // "Näytä lisää" näkyy vain, jos sivuja on vielä jäljellä.
        lisaaNappi.hidden = nykyinenHaku.sivu >= nykyinenHaku.sivujaYhteensa;
    } catch (virhe) {
        naytaTila("Elokuvien haku epäonnistui: " + virhe.message, true);
    }
}

// Hakee yhden elokuvan tiedot, trailerit ja näyttelijät yhdellä kutsulla
// (append_to_response yhdistää useamman rajapinnan vastauksen).
async function haeElokuvanTiedot(id) {
    const elokuva = await haeApista(`/movie/${id}`, {
        append_to_response: "videos,credits",
        include_video_language: "fi,en" // trailerit suomeksi tai englanniksi
    });

    // Jos suomenkielinen kuvaus puuttuu, haetaan englanninkielinen.
    if (!elokuva.overview) {
        const englanniksi = await haeApista(`/movie/${id}`, { language: "en-US" });
        elokuva.overview = englanniksi.overview;
    }
    return elokuva;
}


// ===================================================================
// Datan näyttäminen sivulla
// ===================================================================

// Luo elokuvakortit ja lisää ne ruudukkoon.
function naytaElokuvat(lista) {
    lista.forEach((elokuva) => {
        const kortti = document.createElement("article");
        kortti.className = "kortti";
        kortti.dataset.id = elokuva.id; // id talteen, jotta klikkaus tietää, mikä elokuva avataan
        kortti.tabIndex = 0;            // kortti valittavissa myös näppäimistöllä

        const vuosi = elokuva.release_date ? elokuva.release_date.slice(0, 4) : "–";
        const genreNimet = (elokuva.genre_ids || [])
            .slice(0, 2)
            .map((id) => genret[id])
            .filter(Boolean)
            .map(isoAlkukirjain)
            .join(", ");

        kortti.innerHTML = `
            ${julisteHtml(elokuva.poster_path, elokuva.title, "w342")}
            ${arvosanaHtml(elokuva.vote_average)}
            <div class="kortti-teksti">
                <h2>${suojaa(elokuva.title)}</h2>
                <p>${vuosi}${genreNimet ? " · " + suojaa(genreNimet) : ""}</p>
            </div>
        `;
        elokuvat.appendChild(kortti);
    });
}

// Täyttää tiedot-ikkunan ja avaa sen.
async function avaaTiedot(id) {
    tiedotSisalto.innerHTML = `<p class="tila">Ladataan tietoja…</p>`;
    tiedotIkkuna.showModal();

    try {
        const e = await haeElokuvanTiedot(id);

        const vuosi = e.release_date ? e.release_date.slice(0, 4) : "";
        const kesto = e.runtime ? `${Math.floor(e.runtime / 60)} h ${e.runtime % 60} min` : "";
        const genreNimet = e.genres.map((g) => isoAlkukirjain(g.name)).join(", ");
        const nayttelijat = e.credits.cast.slice(0, 6);
        const ohjaaja = e.credits.crew.find((henkilo) => henkilo.job === "Director");

        // Etsitään YouTube-traileri: ensisijaisesti "Trailer", muuten mikä tahansa YouTube-video.
        const videot = e.videos.results.filter((v) => v.site === "YouTube");
        const traileri = videot.find((v) => v.type === "Trailer") || videot[0];

        tiedotSisalto.innerHTML = `
            <div class="tiedot-tausta" style="${e.backdrop_path
                ? `background-image: url('${KUVA_OSOITE}w1280${e.backdrop_path}')` : ""}"></div>
            <div class="tiedot-runko">
                ${julisteHtml(e.poster_path, e.title, "w342")}
                <div>
                    <h2 id="tiedot-otsikko">${suojaa(e.title)} ${vuosi ? `<span>(${vuosi})</span>` : ""}</h2>
                    ${e.tagline ? `<p class="iskulause">${suojaa(e.tagline)}</p>` : ""}
                    <p class="meta">
                        ${arvosanaHtml(e.vote_average)}
                        ${[kesto, suojaa(genreNimet)].filter(Boolean).join(" · ")}
                    </p>
                    ${ohjaaja ? `<p><strong>Ohjaaja:</strong> ${suojaa(ohjaaja.name)}</p>` : ""}
                    <p class="juoni">${suojaa(e.overview || "Kuvausta ei ole saatavilla.")}</p>
                </div>
            </div>
            ${nayttelijat.length ? `
                <h3>Näyttelijät</h3>
                <ul class="nayttelijat">
                    ${nayttelijat.map((n) => `
                        <li>
                            ${n.profile_path
                                ? `<img src="${KUVA_OSOITE}w185${n.profile_path}" alt="" loading="lazy">`
                                : `<div class="ei-kuvaa">?</div>`}
                            <strong>${suojaa(n.name)}</strong>
                            <span>${suojaa(n.character || "")}</span>
                        </li>`).join("")}
                </ul>` : ""}
            ${traileri ? `
                <h3>Traileri</h3>
                <div class="traileri">
                    <iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(traileri.key)}"
                        title="${suojaa(traileri.name)}" allowfullscreen loading="lazy"></iframe>
                </div>` : ""}
        `;
    } catch (virhe) {
        tiedotSisalto.innerHTML = `<p class="tila virhe">Tietojen haku epäonnistui: ${suojaa(virhe.message)}</p>`;
    }
}

// Sulkee tiedot-ikkunan ja tyhjentää sen (pysäyttää samalla trailerin toiston).
function suljeTiedot() {
    tiedotIkkuna.close();
}


// ===================================================================
// Apufunktiot
// ===================================================================

// Näyttää tilaviestin (lataus, virhe). Tyhjä teksti piilottaa viestin.
function naytaTila(teksti, onVirhe = false) {
    tila.textContent = teksti;
    tila.classList.toggle("virhe", onVirhe);
}

// Julistekuva tai varakuva, jos julistetta ei ole.
function julisteHtml(polku, nimi, koko) {
    if (!polku) {
        return `<div class="juliste ei-julistetta">🎞️</div>`;
    }
    return `<img class="juliste" src="${KUVA_OSOITE}${koko}${polku}" alt="${suojaa(nimi)} – juliste" loading="lazy">`;
}

// Arvosanamerkki, jonka väri riippuu arvosanasta (vihreä/keltainen/punainen).
function arvosanaHtml(arvo) {
    if (!arvo) {
        return "";
    }
    const luokka = arvo >= 7 ? "hyva" : arvo >= 5 ? "keski" : "heikko";
    return `<span class="arvosana ${luokka}" title="TMDB-käyttäjien arvio">★ ${arvo.toFixed(1)}</span>`;
}

// Estää HTML:n tulkinnan API:n palauttamassa tekstissä (esim. nimessä oleva "<").
function suojaa(teksti) {
    const div = document.createElement("div");
    div.textContent = teksti;
    return div.innerHTML;
}

function isoAlkukirjain(teksti) {
    return teksti.charAt(0).toUpperCase() + teksti.slice(1);
}

// Aloittaa uuden haun alusta ja päivittää otsikon.
function uusiHaku(tyyppi, arvo, otsikkoTeksti) {
    nykyinenHaku = { tyyppi, arvo, sivu: 1, sivujaYhteensa: 1 };
    otsikko.textContent = otsikkoTeksti;
    haeElokuvat();
}


// ===================================================================
// Tapahtumankäsittelijät (kaikki lisätään dynaamisesti addEventListenerillä)
// ===================================================================

// Hakulomake: Enter tai Hae-painike.
hakulomake.addEventListener("submit", (tapahtuma) => {
    tapahtuma.preventDefault(); // estetään sivun uudelleenlataus
    const hakusana = hakukentta.value.trim();
    if (hakusana === "") {
        return;
    }
    genrevalikko.value = "";
    uusiHaku("haku", hakusana, `Hakutulokset: "${hakusana}"`);
});

// Listavalikko: valmiit listat (suosituimmat, parhaiten arvioidut…).
listavalikko.addEventListener("change", () => {
    genrevalikko.value = "";
    hakukentta.value = "";
    uusiHaku("lista", listavalikko.value, LISTAT[listavalikko.value]);
});

// Genrevalikko: genren elokuvat suosituimmuusjärjestyksessä. Tyhjä arvo palaa listaan.
genrevalikko.addEventListener("change", () => {
    hakukentta.value = "";
    if (genrevalikko.value === "") {
        uusiHaku("lista", listavalikko.value, LISTAT[listavalikko.value]);
    } else {
        const nimi = genrevalikko.options[genrevalikko.selectedIndex].textContent;
        uusiHaku("genre", genrevalikko.value, `Genre: ${nimi}`);
    }
});

// "Näytä lisää": seuraava sivu samasta hausta.
lisaaNappi.addEventListener("click", () => {
    nykyinenHaku.sivu++;
    haeElokuvat(true);
});

// Korttien klikkaus: yksi kuuntelija koko ruudukolle (event delegation),
// koska kortit luodaan vasta myöhemmin. closest() etsii klikatun kortin.
elokuvat.addEventListener("click", (tapahtuma) => {
    const kortti = tapahtuma.target.closest(".kortti");
    if (kortti) {
        avaaTiedot(kortti.dataset.id);
    }
});

// Sama näppäimistöllä: Enter avaa valitun kortin.
elokuvat.addEventListener("keydown", (tapahtuma) => {
    const kortti = tapahtuma.target.closest(".kortti");
    if (kortti && tapahtuma.key === "Enter") {
        avaaTiedot(kortti.dataset.id);
    }
});

// Tiedot-ikkunan sulkeminen: ✕-painike tai klikkaus ikkunan ulkopuolelle (taustaan).
suljeNappi.addEventListener("click", suljeTiedot);
tiedotIkkuna.addEventListener("click", (tapahtuma) => {
    if (tapahtuma.target === tiedotIkkuna) {
        suljeTiedot();
    }
});
// Kun ikkuna suljetaan (myös Esc-näppäimellä), tyhjennetään sisältö, jotta traileri lakkaa soimasta.
tiedotIkkuna.addEventListener("close", () => {
    tiedotSisalto.innerHTML = "";
});


// ===================================================================
// Käynnistys
// ===================================================================

// Haetaan ensin genret (korttien genrenimiä varten) ja sitten suosituimmat elokuvat.
async function kaynnista() {
    await lataaGenret();
    haeElokuvat();
}

kaynnista();
