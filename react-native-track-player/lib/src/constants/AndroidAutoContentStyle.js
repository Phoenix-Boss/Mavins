/**
 * Define Android Auto's content style. defualt is List. see
 * https://developer.android.com/training/cars/media#apply_content_style
 */
export var AndroidAutoContentStyle;
(function (AndroidAutoContentStyle) {
    AndroidAutoContentStyle[AndroidAutoContentStyle["List"] = 0] = "List";
    AndroidAutoContentStyle[AndroidAutoContentStyle["Grid"] = 1] = "Grid";
    AndroidAutoContentStyle[AndroidAutoContentStyle["CategoryList"] = 2] = "CategoryList";
    AndroidAutoContentStyle[AndroidAutoContentStyle["CategoryGrid"] = 3] = "CategoryGrid";
})(AndroidAutoContentStyle || (AndroidAutoContentStyle = {}));
