require("dotenv").config();
const ImageSearchService = require("./src/services/imageSearchService");

async function testImageSearch() {
  try {
    console.log("Testing Image Search Service...\n");

    // Initialize service
    const imageService = new ImageSearchService();

    // Test 1: Generate query from title and description
    console.log("Test 1: Generate Image Query");
    console.log("=".repeat(50));
    const title = "India Seal 17-Run Win in ODI Thriller vs South Africa";
    const description =
      "India secured a thrilling 17-run victory over South Africa in the 1st ODI on November 30, 2025, taking a 1-0 series lead. Virat Kohli's sensational 135 runs, earning him Player of the Match, anchored India's formidable 349/8. Despite Corbin Bosch's valiant 67 off 51 balls, the Proteas fell short at 332. Kuldeep Yadav's 4 wickets and Harshit Rana's 3 were crucial, with Ravindra Jadeja also contributing to this nail-biting win at Ranchi.";

    console.log("Title:", title);
    console.log("Description:", description.substring(0, 100) + "...\n");

    const searchQuery = await imageService.generateImageQuery(
      title,
      description
    );
    console.log("Generated Search Query:", searchQuery);
    console.log("\n");

    // Test 2: Search for image
    console.log("Test 2: Search for Image");
    console.log("=".repeat(50));
    const imageResult = await imageService.searchImage(searchQuery);

    if (imageResult) {
      console.log("✅ Image found!");
      console.log("Image URL:", imageResult.url);
      console.log("Thumbnail URL:", imageResult.thumbnail);
      console.log("Title:", imageResult.title);
      console.log("Context URL:", imageResult.context);
      console.log("Source:", imageResult.source || "unknown");
    } else {
      console.log("❌ No image found");
    }
    console.log("\n");

    // Test 3: Get image for article (combined)
    console.log("Test 3: Get Image for Article (Combined)");
    console.log("=".repeat(50));
    const articleImage = await imageService.getImageForArticle(
      title,
      description
    );

    if (articleImage) {
      console.log("✅ Article image found!");
      console.log("Image URL:", articleImage.url);
      console.log("Thumbnail:", articleImage.thumbnail);
      console.log("Search Query Used:", articleImage.search_query);
      console.log("Source:", articleImage.source || "unknown");
    } else {
      console.log("❌ No image found for article");
    }

    console.log("\n✅ All tests completed!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("Stack:", error.stack);
  }
}

// Run test
testImageSearch();
