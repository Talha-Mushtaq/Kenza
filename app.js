import { createRequire } from 'module';
import fs from "fs"
import { SparqlEndpointFetcher } from "fetch-sparql-endpoint"
import { fileURLToPath } from 'url';
import express from 'express';
import createHttpError from 'http-errors';
import path from 'path';
import * as dotenv from 'dotenv'
dotenv.config()
// Express initialization
var app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname + 'public')));

// ========== DBPEDIA FUNCTIONS START ==========
// Express Router
var router = express.Router();

/**
 * Collect data from the ReadableStream returned from DBPedia and put it in a JSON object
 * @param {ReadableStream} stream 
 * @returns 
 */
const streamToObj = async (stream) => {
  const jsonObj = [];

  return new Promise((resolve, reject) => {
    // ==== Upon recieving records from DBPedia (data = one record) ====
    stream.on('data', (chunk) => {
      // Create json object from record
      // ex : {label : "title_of_book", "name": "name_of_author"}
      let obj = {}
      for (const key in chunk) {
        obj[key] = chunk[key]['value']
      }

      // Remove blanks in Authors
      let authors = obj["authors"].split(" & ")
      authors = authors.filter(author => author.length !== 0)

      // Remove duplicates in Authors (case sensitive)
      let lowercase_authors = []
      let unique_authors = []
      for (const author of authors) {
        let author_lowercase = author.toLowerCase()
        if (lowercase_authors.includes(author_lowercase)) {
          continue
        }

        lowercase_authors.push(author_lowercase)
        unique_authors.push(author)
      }

      obj["authors"] = unique_authors.join(" & ")
      jsonObj.push(obj);
    });

    // ===== If an error has occurred =====
    stream.on('error', (err) => reject(err));

    // ===== When the stream finishes =====
    stream.on('end', () => resolve(jsonObj));
  })
}

/**
 * Get Book information from URI provided either via POST or from the local database
 */
let bookInfoRouter = router.get('/', async function (req, res, next) {
  // ======== MAIN (TESTING PURPOSES ONLY) ==========
  let endpoint = 'https://dbpedia.org/sparql'
  let urisFilename = "uris.json"

  // Get URI list either from JSON POST BODY or from local database
  let uriArray = []
  if (Array.isArray(req.body) && req.body.length !== 0) {
    uriArray = req.body
  } else {
    // Parse URI List
    let urisFile = fs.readFileSync(urisFilename, "utf-8")
    uriArray = JSON.parse(urisFile)
  }

  // Fetch bindings from the endpoint function
  const myFetcher = new SparqlEndpointFetcher({
    method:
      'POST',
  })

  // Create URI Filter string ("uri1", "uri2",...)
  uriArray = uriArray.map(el => (`<${el}>`))
  let uriArrayString = uriArray.join(", ")

  // Actual query to send to the DBPedia
  let query =
    ' PREFIX dbo:  <http://dbpedia.org/ontology/> \n ' +
    ' PREFIX res:  <http://dbpedia.org/resource/> \n ' +
    ' PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> \n ' +
    ' PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#> \n ' +
    ' PREFIX dbpedia2: <http://dbpedia.org/property/> \n ' +
    ' SELECT ?book ?title (group_concat(distinct ?authors;separator=" & ") as ?authors) ?abstract \n ' +
    ' WHERE {   \n ' +
    '   ?book a dbo:Book . \n ' +
    '   {?book ?p ?authors . \n ' +
    '      FILTER (?p = dbp:author || ?p = dbpedia2:authors) \n ' +
    '   } \n ' +
    '   UNION \n ' +
    '   {?book ?p ?auth . \n ' +
    '      ?auth ?n ?authors .  \n ' +
    '      FILTER (?p = dbp:author || ?p = dbpedia2:authors) \n ' +
    '      FILTER (?n = dbp:name || ?n = rdfs:label) \n ' +
    '   } \n ' +
    '   ?book rdfs:label ?title .   \n ' +
    '   ?book dbo:abstract ?abstract .  \n ' +
    '   FILTER (langMatches(lang(?abstract), "en"))  \n ' +
    '   FILTER (langMatches(lang(?title), "en"))  \n ' +
    '   FILTER (langMatches(lang(?authors), "en"))   \n ' +
    `   FILTER (?book IN (${uriArrayString})) \n ` +
    '} group by ?book ?title ?abstract ?author \n';

  // TIP : To limit the number of results, use "LIMIT x". 
  // For pagination, use LIMIT with OFFSET. 

  try {
    // Send request and listen to the response
    const bindingsStream = await myFetcher.fetchBindings(endpoint, query)
    const jsonObj = await streamToObj(bindingsStream)

    // TODO : RETURN ERROR 200 in API With json 
    res.json(jsonObj)
  }
  catch (error) {
    // TODO : RETURN ERROR 500 in API With / Without error message
    createHttpError(500)
  }
});

app.use('/book_info', bookInfoRouter)
// ========== DBPEDIA FUNCTIONS END ==========

// Error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

app.listen(process.env.PORT, () => {
  console.log(`Example app listening on port ${process.env.PORT}`)
})
