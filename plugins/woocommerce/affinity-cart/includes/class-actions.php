<?php
namespace AffinityCart;

defined( 'ABSPATH' ) || exit;

/** What the merchant (or autopilot) can do with the results, inside WooCommerce. */
class Actions {
	/** Cross-sells for every product, plus kits published as grouped products. */
	public static function apply( array $state ): array {
		$updated = 0;
		foreach ( (array) ( $state['recs'] ?? array() ) as $product_id => $recs ) {
			$product = wc_get_product( (int) $product_id );
			if ( ! $product ) {
				continue;
			}
			$product->set_cross_sell_ids( array_map( static fn( $r ) => (int) $r['productId'], array_slice( $recs, 0, 4 ) ) );
			$product->update_meta_data( '_affinity_cart_applied', time() );
			$product->save();
			++$updated;
		}
		$kits    = 0;
		$current = array();
		foreach ( (array) ( $state['kits'] ?? array() ) as $kit ) {
			if ( self::publish_kit( $kit ) ) {
				$current[] = $kit['id'];
				++$kits;
			}
		}
		// Kits that no longer come out of the analysis go back to draft.
		$published = (array) get_option( 'affinity_cart_kits', array() );
		foreach ( $published as $key => $kit ) {
			if ( ! is_string( $key ) || ! in_array( $key, $current, true ) ) {
				if ( ! empty( $kit['postId'] ) ) {
					wp_update_post( array( 'ID' => $kit['postId'], 'post_status' => 'draft' ) );
				}
				unset( $published[ $key ] );
			}
		}
		update_option( 'affinity_cart_kits', $published, false );
		update_option( 'affinity_cart_applied_at', time() );
		return array( 'updated' => $updated, 'kits' => $kits );
	}

	/** A kit becomes a real WooCommerce grouped product; the cart gives the kit discount. */
	public static function publish_kit( array $kit ): ?int {
		$ids = array_values( array_filter( array_map( 'intval', $kit['productIds'] ?? array() ), static fn( $id ) => (bool) wc_get_product( $id ) ) );
		if ( count( $ids ) < 2 ) {
			return null;
		}
		$published = (array) get_option( 'affinity_cart_kits', array() );
		$existing  = $published[ $kit['id'] ]['postId'] ?? 0;
		$product   = $existing ? wc_get_product( $existing ) : null;
		if ( ! $product instanceof \WC_Product_Grouped ) {
			$product = new \WC_Product_Grouped();
		}
		$product->set_name( $kit['name'] ?: __( 'Kit', 'affinity-cart' ) );
		$product->set_description( $kit['pitch'] ?? '' );
		$product->set_short_description( $kit['pitch'] ?? '' );
		$product->set_children( $ids );
		$product->set_status( 'publish' );
		$first = wc_get_product( $ids[0] );
		if ( $first && $first->get_image_id() ) {
			$product->set_image_id( $first->get_image_id() );
		}
		$product->update_meta_data( '_affinity_kit_id', $kit['id'] );
		$post_id = $product->save();

		$published[ $kit['id'] ] = array(
			'id'         => $kit['id'],
			'name'       => $kit['name'],
			'productIds' => $ids,
			'postId'     => $post_id,
		);
		update_option( 'affinity_cart_kits', $published, false );
		return $post_id;
	}

	/** A ghost-catalog opportunity becomes a draft product the merchant can fill in. */
	public static function draft_from_ghost( array $ghost ): int {
		$product = new \WC_Product_Simple();
		$product->set_name( $ghost['title'] );
		$product->set_status( 'draft' );
		$lines   = array( '<p>' . esc_html( $ghost['why'] ?? '' ) . '</p>' );
		$lines[] = '<p><strong>' . esc_html__( 'Brands to look at:', 'affinity-cart' ) . '</strong> ' . esc_html( implode( ', ', $ghost['examples'] ?? array() ) ) . '</p>';
		$lines[] = '<p><strong>' . esc_html__( 'Why Affinity Cart suggested it:', 'affinity-cart' ) . '</strong> ' . esc_html( implode( '; ', $ghost['evidence'] ?? array() ) ) . '</p>';
		$product->set_description( implode( "\n", $lines ) );
		$product->update_meta_data( '_affinity_ghost', $ghost['title'] );
		$id = $product->save();

		$drafts                    = (array) get_option( 'affinity_cart_drafts', array() );
		$drafts[ $ghost['title'] ] = $id;
		update_option( 'affinity_cart_drafts', $drafts, false );
		return $id;
	}

	/**
	 * A tribe as a CSV for the newsletter tool. The service only ever saw
	 * pseudonyms; the mapping back to real customers happens here, in WordPress.
	 */
	public static function export_tribe( array $tribe ): array {
		$members = array_flip( (array) ( $tribe['members'] ?? array() ) );
		$rows    = array( array( 'email', 'first_name', 'last_name', 'city', 'country', 'tribe' ) );
		foreach ( get_users( array( 'role' => 'customer', 'fields' => 'ID' ) ) as $id ) {
			if ( ! isset( $members[ Sync::pseudonym( $id ) ] ) ) {
				continue;
			}
			$c      = new \WC_Customer( $id );
			$rows[] = array( $c->get_email(), $c->get_first_name(), $c->get_last_name(), $c->get_billing_city(), $c->get_billing_country(), $tribe['name'] ?? '' );
		}
		$fh = fopen( 'php://temp', 'r+' );
		foreach ( $rows as $row ) {
			fputcsv( $fh, $row, ',', '"', '\\' );
		}
		rewind( $fh );
		$csv = stream_get_contents( $fh );
		fclose( $fh );
		return array( 'csv' => $csv, 'count' => count( $rows ) - 1 );
	}
}
