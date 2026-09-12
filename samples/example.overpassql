// Cafes and restaurants in a 20 m box on Khreshchatyk in Kyiv. Run with "Level0L: Run
// Overpass query" while this file is active, or select a query anywhere and
// run the command. The bounding box is south,west,north,east. "out meta" is
// needed to get object versions, without which the objects cannot be uploaded
// later. The overpass turbo placeholder {{bbox}} works too and is replaced
// with the extent of the nodes in the Level0L document open next to the query.
[out:xml][timeout:25][bbox:50.44976,30.52335,50.44995,30.52363];
nwr[amenity~"^(cafe|restaurant)$"];
out meta;
