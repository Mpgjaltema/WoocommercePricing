// index.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Oracle APEX base URL
const ORACLE_BASE_URL = 'https://apexers.nl/ords/pwz/prod_enhancer';

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        service: 'WooCommerce Pricing API',
        version: '1.0.0',
        status: 'running',
        timestamp: new Date().toISOString()
    });
});

app.get('/pricing', async (req, res) => {
    try {
        console.log('[pricing] Fetching pricing data from Oracle...');
        
        const response = await axios.get(`${ORACLE_BASE_URL}/pricing`, {
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'WooCommerce-Pricing/1.0'
            }
        });
        
        console.log('[pricing] Oracle response received:', JSON.stringify(response.data, null, 2));
        
        // Transform Oracle response to expected format
        const pricingData = transformPricingData(response.data);
        
        res.json({
            success: true,
            pricing: pricingData,
            cached: false,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[pricing] Error fetching pricing:', error.message);
        
        // Return fallback pricing on error
        const fallbackPricing = getFallbackPricing();
        
        res.status(200).json({
            success: true,
            pricing: fallbackPricing,
            cached: true,
            fallback: true,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// POST /validate-pricing - Validate payment amounts against database prices
app.post('/validate-pricing', async (req, res) => {
    try {
        const { plan_type, billing_type, amount } = req.body;
        
        console.log('[validate] Validating pricing:', { plan_type, billing_type, amount });
        
        if (!plan_type || !billing_type || !amount) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: plan_type, billing_type, amount'
            });
        }
        
        // Fetch current pricing from Oracle
        const response = await axios.get(`${ORACLE_BASE_URL}/pricing`, {
            timeout: 5000
        });
        
        const pricingData = transformPricingData(response.data);
        
        // Validate amount
        const isValid = validateAmount(plan_type, billing_type, amount, pricingData);
        
        res.json({
            success: true,
            valid: isValid,
            expected_amount: getExpectedAmount(plan_type, billing_type, pricingData),
            provided_amount: amount,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[validate] Error validating pricing:', error.message);
        
        res.status(500).json({
            success: false,
            error: 'Failed to validate pricing',
            details: error.message
        });
    }
});

// Transform Oracle response to frontend format
function transformPricingData(oracleData) {
    // Handle different possible Oracle response formats
    let data = oracleData;
    if (oracleData.items && oracleData.items.length > 0) {
        data = oracleData.items[0]; // ORDS collection format
    }
    
    const monthlyPerProduct = parseFloat(data.per_product_monthly || data.PER_PRODUCT_MONTHLY || 99);
    const monthlyBulkUpdate = parseFloat(data.bulk_update_monthly || data.BULK_UPDATE_MONTHLY || 349);
    const discountPercentage = parseInt(data.discount_percentage || data.DISCOUNT_PERCENTAGE || 25);
    
    // Calculate yearly prices with discount
    const yearlyPerProduct = +(monthlyPerProduct * 12 * (1 - discountPercentage / 100)).toFixed(2);
    const yearlyBulkUpdate = +(monthlyBulkUpdate * 12 * (1 - discountPercentage / 100)).toFixed(2); 
    
    return {
        per_product: {
            '1 month': monthlyPerProduct,
            '12 months': yearlyPerProduct
        },
        bulk_update: {
            '1 month': monthlyBulkUpdate,
            '12 months': yearlyBulkUpdate
        },
        discount_percentage: discountPercentage,
        promo_text: data.promo_text || data.PROMO_TEXT || '',
		promo_active: ['Y', 'true', true].includes(data.promo_active || data.PROMO_ACTIVE)
    };
}

// Validate payment amount against expected price
function validateAmount(planType, billingType, amount, pricingData) {
    const expectedAmount = getExpectedAmount(planType, billingType, pricingData);
    const tolerance = 0.01; // Allow 1 cent difference for rounding
    
    return Math.abs(amount - expectedAmount) <= tolerance;
}

// Get expected amount for plan/billing combination
function getExpectedAmount(planType, billingType, pricingData) {
    if (planType === 'per_product' || planType === 'per_product_yearly') {
        return billingType === 'yearly' || planType === 'per_product_yearly' 
            ? pricingData.per_product.yearly 
            : pricingData.per_product.monthly;
    }
    
    if (planType === 'bulk_update' || planType === 'bulk_update_yearly') {
        return billingType === 'yearly' || planType === 'bulk_update_yearly'
            ? pricingData.bulk_update.yearly 
            : pricingData.bulk_update.monthly;
    }
    
    return 0;
}

// Fallback pricing when Oracle is unavailable
function getFallbackPricing() {
    return {
        per_product: {
            '1 month': 99,
            '12 months': 891  
        },
        bulk_update: {
            '1 month': 349,
            '12 months': 3141 
        },
        discount_percentage: 25,
        promo_text: '',
        promo_active: false
    };
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('[error]', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        available_endpoints: [
            'GET /',
            'GET /pricing',
            'POST /validate-pricing'
        ]
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 WooCommerce Pricing API running on port ${PORT}`);
    console.log(`📡 Oracle APEX URL: ${ORACLE_BASE_URL}`);
    console.log(`💰 Available endpoints:`);
    console.log(`   GET  / - Health check`);
    console.log(`   GET  /pricing - Fetch dynamic pricing`);
    console.log(`   POST /validate-pricing - Validate payment amounts`);
});