// Cafes and restaurants in a 20 m box on Khreshchatyk in Kyiv. Run with "Level0L: Run
// Overpass query" while this file is active, or select a query anywhere and
// run the command. The bounding box is south,west,north,east. "out meta" is
// needed to get object versions, without which the objects cannot be uploaded
// later. The overpass turbo placeholder {{bbox}} works too and is replaced
// with the extent of the nodes in the Level0L document open next to the query.
[out:xml][timeout:25][bbox:24.030506,49.840342,24.033242,49.841629];
nwr[amenity];
out meta;
