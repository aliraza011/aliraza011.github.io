/**
 * Publications auto-fetcher — ORCID + Semantic Scholar
 * Fetches works from ORCID, enriches with citation data from Semantic Scholar,
 * and renders them grouped by year into #publications-list.
 */
(function () {
  'use strict';

  var ORCID_ID = '0000-0001-8326-8325';
  var ORCID_API = 'https://pub.orcid.org/v3.0/' + ORCID_ID + '/works';
  var S2_API = 'https://api.semanticscholar.org/graph/v1/paper/DOI:';
  var S2_FIELDS = 'citationCount,url,openAccessPdf,title';
  var S2_DELAY_MS = 120; // ~8 req/s, well under 100/5min

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // ---------- ORCID parsing helpers ----------

  function extractTitle(workSummary) {
    try {
      return workSummary.title['title'].value || '';
    } catch (e) {
      return '';
    }
  }

  function extractYear(workSummary) {
    try {
      var y = workSummary['publication-date'] && workSummary['publication-date'].year;
      return y ? parseInt(y.value, 10) : null;
    } catch (e) {
      return null;
    }
  }

  function extractJournal(workSummary) {
    try {
      var jt = workSummary['journal-title'];
      return jt ? jt.value : '';
    } catch (e) {
      return '';
    }
  }

  function extractDoi(workSummary) {
    try {
      var ids = workSummary['external-ids']['external-id'];
      for (var i = 0; i < ids.length; i++) {
        if (ids[i]['external-id-type'] === 'doi') {
          return ids[i]['external-id-value'];
        }
      }
    } catch (e) { /* no DOI */ }
    return null;
  }

  function extractType(workSummary) {
    try {
      return workSummary.type || '';
    } catch (e) {
      return '';
    }
  }

  // ---------- Fetch helpers ----------

  function fetchJson(url, headers) {
    return fetch(url, { headers: headers || {} })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.json();
      });
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ---------- Core pipeline ----------

  function fetchOrcidWorks() {
    return fetchJson(ORCID_API, { Accept: 'application/json' })
      .then(function (data) {
        var works = [];
        var groups = (data && data.group) || [];
        groups.forEach(function (g) {
          var summaries = g['work-summary'] || [];
          if (summaries.length === 0) return;
          var ws = summaries[0]; // first summary is the preferred one
          var title = extractTitle(ws);
          if (!title) return;
          works.push({
            title: title,
            year: extractYear(ws),
            journal: extractJournal(ws),
            doi: extractDoi(ws),
            type: extractType(ws),
            citations: null,
            s2Url: null,
            pdfUrl: null
          });
        });
        return works;
      });
  }

  function enrichWithSemanticScholar(works) {
    var queue = works.filter(function (w) { return w.doi; });
    var idx = 0;

    function next() {
      if (idx >= queue.length) return Promise.resolve();
      var w = queue[idx++];
      return fetchJson(S2_API + encodeURIComponent(w.doi) + '?fields=' + S2_FIELDS)
        .then(function (paper) {
          if (paper.citationCount != null) w.citations = paper.citationCount;
          if (paper.url) w.s2Url = paper.url;
          if (paper.openAccessPdf && paper.openAccessPdf.url) w.pdfUrl = paper.openAccessPdf.url;
        })
        .catch(function () { /* S2 miss — ignore */ })
        .then(function () { return delay(S2_DELAY_MS); })
        .then(next);
    }

    return next().then(function () { return works; });
  }

  // ---------- Rendering ----------

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function renderPublications(works, container) {
    // Sort by year desc, then title asc
    works.sort(function (a, b) {
      var ya = a.year || 0, yb = b.year || 0;
      if (yb !== ya) return yb - ya;
      return (a.title || '').localeCompare(b.title || '');
    });

    // Group by year
    var years = [];
    var byYear = {};
    works.forEach(function (w) {
      var y = w.year || 'Unknown';
      if (!byYear[y]) {
        byYear[y] = [];
        years.push(y);
      }
      byYear[y].push(w);
    });

    var html = '';
    years.forEach(function (year) {
      html += '<h2 class="bibliography">' + esc(String(year)) + '</h2>';
      html += '<ol class="bibliography">';
      byYear[year].forEach(function (w) {
        html += '<li><div class="pub-entry">';

        // Title
        html += '<div class="pub-title">';
        if (w.doi) {
          html += '<a href="https://doi.org/' + esc(w.doi) + '" target="_blank" rel="noopener">';
          html += esc(w.title) + '</a>';
        } else {
          html += esc(w.title);
        }
        html += '</div>';

        // Journal / venue
        if (w.journal) {
          html += '<div class="pub-venue"><em>' + esc(w.journal) + '</em>';
          if (w.year) html += ', ' + esc(String(w.year));
          html += '</div>';
        }

        // Badges row
        var badges = '';
        if (w.citations != null && w.citations > 0) {
          badges += '<span class="pub-cite-badge" title="Citations">'
            + '<i class="fas fa-quote-right"></i> ' + w.citations + '</span>';
        }
        if (w.pdfUrl) {
          badges += '<a class="pub-pdf-link" href="' + esc(w.pdfUrl)
            + '" target="_blank" rel="noopener" title="Open Access PDF">'
            + '<i class="fas fa-file-pdf"></i> PDF</a>';
        }
        if (w.s2Url) {
          badges += '<a class="pub-s2-link" href="' + esc(w.s2Url)
            + '" target="_blank" rel="noopener" title="Semantic Scholar">'
            + '<i class="fas fa-graduation-cap"></i> S2</a>';
        }
        if (w.doi) {
          badges += '<a class="pub-doi-link" href="https://doi.org/' + esc(w.doi)
            + '" target="_blank" rel="noopener" title="DOI">'
            + '<i class="fas fa-link"></i> DOI</a>';
        }
        if (badges) {
          html += '<div class="pub-badges">' + badges + '</div>';
        }

        html += '</div></li>';
      });
      html += '</ol>';
    });

    container.innerHTML = html;
  }

  function showLoading(container) {
    container.innerHTML =
      '<div class="pub-loading">' +
      '<div class="pub-loading-spinner"></div>' +
      '<p>Fetching publications from ORCID&hellip;</p>' +
      '</div>';
  }

  function showError(container, msg) {
    container.innerHTML =
      '<div class="pub-error">' +
      '<p>' + esc(msg) + '</p>' +
      '</div>';
  }

  // ---------- Entry point ----------

  ready(function () {
    var container = document.getElementById('publications-list');
    if (!container) return;

    showLoading(container);

    fetchOrcidWorks()
      .then(function (works) {
        if (works.length === 0) {
          showError(container, 'No publications found on ORCID.');
          return;
        }
        // Render immediately with ORCID data
        renderPublications(works, container);
        // Then enrich in-place with S2 citation data
        return enrichWithSemanticScholar(works).then(function (enriched) {
          renderPublications(enriched, container);
        });
      })
      .catch(function (err) {
        console.error('Publications fetch failed:', err);
        showError(container,
          'Could not load publications automatically. Please check back later or visit my ORCID profile.');
      });
  });
})();
