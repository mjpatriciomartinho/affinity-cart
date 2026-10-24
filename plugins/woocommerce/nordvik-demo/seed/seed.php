<?php
/**
 * Seeds the Nordvik demo store into WooCommerce. Run inside WordPress (Playground runPHP).
 * Idempotent: does nothing once the `nordvik_seeded` option is set.
 */

defined( 'ABSPATH' ) || require_once '/wordpress/wp-load.php';

if ( get_option( 'nordvik_seeded' ) ) {
	return;
}

$dir       = __DIR__;
$products  = json_decode( file_get_contents( "$dir/products.json" ), true );
$customers = json_decode( file_get_contents( "$dir/customers.json" ), true );
$orders    = json_decode( file_get_contents( "$dir/orders.json" ), true );

// Store settings: Madrid, euros, open for business.
update_option( 'blogname', 'Nordvik' );
update_option( 'blogdescription', 'Urban outdoor & slow culture, from Madrid' );
update_option( 'woocommerce_store_address', 'Calle de Fuencarral 45' );
update_option( 'woocommerce_store_city', 'Madrid' );
update_option( 'woocommerce_store_postcode', '28004' );
update_option( 'woocommerce_default_country', 'ES:M' );
update_option( 'woocommerce_currency', 'EUR' );
update_option( 'woocommerce_currency_pos', 'right_space' );
update_option( 'woocommerce_price_thousand_sep', '.' );
update_option( 'woocommerce_price_decimal_sep', ',' );
update_option( 'woocommerce_coming_soon', 'no' );
update_option( 'woocommerce_onboarding_profile', array( 'skipped' => true ) );
update_option( 'woocommerce_task_list_hidden', 'yes' );

$term = static function ( string $name, string $taxonomy ): int {
	$found = term_exists( $name, $taxonomy );
	if ( $found ) {
		return (int) $found['term_id'];
	}
	return (int) wp_insert_term( $name, $taxonomy )['term_id'];
};

// A shop you can actually buy from: cash on delivery, nothing to ship.
update_option( 'woocommerce_ship_to_countries', 'disabled' );
update_option(
	'woocommerce_cod_settings',
	array(
		'enabled'      => 'yes',
		'title'        => 'Pay on collection',
		'description'  => 'Demo shop: no payment is taken.',
		'instructions' => '',
	)
);

require_once ABSPATH . 'wp-admin/includes/image.php';
$attach_image = static function ( string $sku ) use ( $dir ): int {
	$file = "$dir/images/$sku.jpg";
	if ( ! file_exists( $file ) ) {
		return 0;
	}
	$upload = wp_upload_bits( "$sku.jpg", null, file_get_contents( $file ) );
	if ( ! empty( $upload['error'] ) ) {
		return 0;
	}
	$id = wp_insert_attachment(
		array( 'post_mime_type' => 'image/jpeg', 'post_title' => $sku, 'post_status' => 'inherit' ),
		$upload['file']
	);
	// Thumbnails need an image editor; without one WordPress serves the full image.
	try {
		wp_update_attachment_metadata( $id, wp_generate_attachment_metadata( $id, $upload['file'] ) );
	} catch ( \Throwable $e ) {
		unset( $e );
	}
	return (int) $id;
};

$by_sku = array();
foreach ( $products as $p ) {
	$product = new WC_Product_Simple();
	$product->set_name( $p['name'] );
	$product->set_sku( $p['sku'] );
	$product->set_regular_price( (string) $p['price'] );
	$product->set_description( $p['description'] );
	$product->set_short_description( $p['description'] );
	$product->set_manage_stock( true );
	$product->set_stock_quantity( $p['stock'] );
	$product->set_category_ids( array( $term( $p['category'], 'product_cat' ) ) );
	$image = $attach_image( $p['sku'] );
	if ( $image ) {
		$product->set_image_id( $image );
	}
	$id = $product->save();
	if ( taxonomy_exists( 'product_brand' ) ) {
		wp_set_object_terms( $id, array( $term( $p['brand'], 'product_brand' ) ), 'product_brand' );
	}
	$by_sku[ $p['sku'] ] = $id;
}

$by_ref = array();
foreach ( $customers as $c ) {
	$customer = new WC_Customer();
	$customer->set_email( $c['email'] );
	$customer->set_username( strtok( $c['email'], '@' ) );
	$customer->set_password( wp_generate_password() );
	$customer->set_first_name( $c['first_name'] );
	$customer->set_last_name( $c['last_name'] );
	$customer->set_billing_first_name( $c['first_name'] );
	$customer->set_billing_last_name( $c['last_name'] );
	$customer->set_billing_email( $c['email'] );
	$customer->set_billing_city( $c['city'] );
	$customer->set_billing_country( $c['country'] );
	$customer->set_shipping_city( $c['city'] );
	$customer->set_shipping_country( $c['country'] );
	$by_ref[ $c['ref'] ] = array( 'id' => $customer->save(), 'data' => $c );
}

// Historical orders: don't touch today's stock levels or send emails.
remove_action( 'woocommerce_order_status_completed', 'wc_maybe_reduce_stock_levels' );
remove_action( 'woocommerce_payment_complete', 'wc_maybe_reduce_stock_levels' );
add_filter( 'woocommerce_email_enabled_customer_completed_order', '__return_false' );

foreach ( $orders as $o ) {
	$c     = $by_ref[ $o['customer'] ];
	$order = wc_create_order( array( 'customer_id' => $c['id'] ) );
	foreach ( $o['items'] as $item ) {
		$order->add_product( wc_get_product( $by_sku[ $item['sku'] ] ), $item['qty'] );
	}
	$order->set_address(
		array(
			'first_name' => $c['data']['first_name'],
			'last_name'  => $c['data']['last_name'],
			'email'      => $c['data']['email'],
			'city'       => $c['data']['city'],
			'country'    => $c['data']['country'],
		),
		'billing'
	);
	$order->set_date_created( strtotime( $o['date'] . ' 12:00:00' ) );
	$order->calculate_totals( false );
	$order->set_status( 'completed' );
	$order->set_date_completed( strtotime( $o['date'] . ' 18:00:00' ) );
	$order->save();
}

// Visitors browse as the demo admin; give them an address so checkout is one click.
$admin = new WC_Customer( 1 );
$admin->set_billing_first_name( 'Alex' );
$admin->set_billing_last_name( 'Demo' );
$admin->set_billing_address_1( 'Calle de Fuencarral 45' );
$admin->set_billing_city( 'Madrid' );
$admin->set_billing_postcode( '28004' );
$admin->set_billing_country( 'ES' );
$admin->set_billing_state( 'M' );
$admin->set_billing_email( 'alex@example.com' );
$admin->save();

// The shop is the home page; drop WordPress's sample content.
update_option( 'show_on_front', 'page' );
update_option( 'page_on_front', wc_get_page_id( 'shop' ) );
foreach ( array( 'hello-world' => 'post', 'sample-page' => 'page' ) as $slug => $type ) {
	$post = get_page_by_path( $slug, OBJECT, $type );
	if ( $post ) {
		wp_delete_post( $post->ID, true );
	}
}

update_option( 'nordvik_seeded', time() );
echo 'Seeded ' . count( $by_sku ) . ' products, ' . count( $by_ref ) . ' customers, ' . count( $orders ) . " orders\n";
