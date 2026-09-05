ALTER TABLE "CustomerReview"
ADD CONSTRAINT "CustomerReview_productRating_check"
CHECK ("productRating" BETWEEN 1 AND 5),
ADD CONSTRAINT "CustomerReview_merchantRating_check"
CHECK ("merchantRating" BETWEEN 1 AND 5);

ALTER TABLE "SearchEvent"
ADD CONSTRAINT "SearchEvent_resultCount_check"
CHECK ("resultCount" >= 0),
ADD CONSTRAINT "SearchEvent_page_check"
CHECK ("page" >= 1),
ADD CONSTRAINT "SearchEvent_pageSize_check"
CHECK ("pageSize" BETWEEN 1 AND 100),
ADD CONSTRAINT "SearchEvent_countryCode_check"
CHECK ("countryCode" IS NULL OR "countryCode" ~ '^[A-Z]{2}$');
